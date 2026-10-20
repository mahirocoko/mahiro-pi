import { spawn } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";

// The permission classifier is content-blind; only the explicit filtered npm,
// dotenv, PyPI, and certificate tools read their files. No installed-hook import, shell
// execution or logs.
const POLICY = String.raw`
import json, os, re, shlex, sys
from pathlib import PurePosixPath

SENSITIVE_BASENAMES = {'.env', '.npmrc', '.pypirc', 'auth.json', 'credentials.json',
    'id_dsa', 'id_ecdsa', 'id_ecdsa_sk', 'id_ed25519', 'id_ed25519_sk', 'id_rsa', 'id_xmss', 'identity'}
SAFE_DOTENV_TEMPLATE_BASENAMES = {'.env.example', '.env.sample', '.env.template'}
SSH_SAFE_BASENAMES = {'authorized_keys', 'config', 'known_hosts', 'known_hosts.old'}
READ_COMMAND_BASENAMES = {'awk', 'base64', 'bat', 'cat', 'grep', 'head', 'hexdump',
    'less', 'more', 'openssl', 'rg', 'sed', 'strings', 'tail', 'xxd'}
SAFE_METADATA_COMMAND_BASENAMES = {'[', 'find', 'ls', 'stat', 'test'}
LITERAL_OUTPUT_COMMANDS = {'echo', 'printf'}
SOURCE_NAME_EXTENSIONS = {'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'}
CREDENTIAL_DATA_NAME_PARTS = {'json', 'yaml', 'yml', 'toml', 'ini', 'conf', 'cfg',
    'env', 'txt', 'key', 'pem', 'p12', 'pfx'}

def basename(value):
    normalized = value.replace('\\', '/').rstrip('/')
    return PurePosixPath(normalized).name if normalized else ''

def is_sensitive_path(value):
    normalized = value.replace('\\', '/')
    name = basename(value).lower()
    if not name or name in SAFE_DOTENV_TEMPLATE_BASENAMES:
        return False
    lower_path = normalized.lower()
    if re.fullmatch(r'/proc/[^/]+/environ', lower_path):
        return True
    if (lower_path.startswith(('~/.ssh/', '.ssh/')) or '/.ssh/' in lower_path):
        if name not in SSH_SAFE_BASENAMES and not name.endswith('.pub'):
            return True
    if any(fragment in lower_path for fragment in ('/.letta/lc-local-backend/providers/', '/lc-local-backend/providers/')):
        return True
    # This only narrows the ambiguous prefix rule. Exact names, key suffixes
    # and protected directories retain priority; it does not inspect contents.
    parts = name.split('.')
    prefix_source = (parts[-1] in SOURCE_NAME_EXTENSIONS
        and not any(part in CREDENTIAL_DATA_NAME_PARTS for part in parts[1:-1]))
    return (name == '.env' or name.startswith('.env.') or name in SENSITIVE_BASENAMES
        or name.lower().endswith(('.key', '.pem', '.p12', '.pfx'))
        or (name.startswith(('credentials.', 'secret.', 'secrets.')) and not prefix_source))

def extract_substitutions(text, shell_quotes=True):
    subs = []
    i = 0
    quote = None
    while i < len(text):
        if text[i] == '\\' and quote != "'":
            i += 2
            continue
        if shell_quotes and quote == "'":
            if text[i] == "'":
                quote = None
            i += 1
            continue
        if shell_quotes and text[i] == "'" and quote is None:
            quote = "'"
            i += 1
            continue
        if shell_quotes and text[i] == '"':
            quote = None if quote == '"' else '"'
            i += 1
            continue
        if shell_quotes and text[i] == '#' and quote is None and (i == 0 or text[i-1].isspace() or text[i-1] in ';|&('):
            end = text.find('\n', i)
            i = len(text) if end == -1 else end + 1
            continue
        if text[i:i+2] == '$(':
            depth = 1
            start = i + 2
            j = start
            while j < len(text) and depth > 0:
                if text[j] == '\\':
                    j += 2
                elif text[j] == '(':
                    depth += 1
                    j += 1
                elif text[j] == ')':
                    depth -= 1
                    j += 1
                elif text[j] in ('"', "'"):
                    quote = text[j]
                    j += 1
                    while j < len(text) and text[j] != quote:
                        if text[j] == '\\':
                            j += 1
                        j += 1
                    if j < len(text):
                        j += 1
                else:
                    j += 1
            if depth == 0:
                subs.append(text[start:j-1])
                i = j
                continue
        elif text[i] == chr(96):
            start = i + 1
            j = start
            while j < len(text) and text[j] != chr(96):
                j += 2 if text[j] == '\\' else 1
            if j < len(text):
                subs.append(text[start:j])
                i = j + 1
                continue
        i += 1
    return subs

def heredoc_headers(line):
    headers = []
    i = 0
    quote = None
    while i < len(line):
        ch = line[i]
        if ch == '\\' and quote != "'":
            i += 2
            continue
        if quote:
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in {"'", '"'}:
            quote = ch
            i += 1
            continue
        if ch == '#' and (i == 0 or line[i-1].isspace()):
            break
        if line[i:i+3] == '<<<':
            i += 3
            continue
        if line[i:i+2] != '<<':
            i += 1
            continue
        match = re.match(r'''<<(-?)\s*(['"]([A-Za-z_][A-Za-z0-9_]*)['"]|\\([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))(?=\s|[;&|)]|$)''', line[i:])
        if not match:
            raise ValueError('unsupported heredoc delimiter')
        delim = match.group(3) or match.group(4) or match.group(5)
        quoted = match.group(2).startswith(("'", '"', '\\'))
        headers.append((delim, quoted, bool(match.group(1))))
        i += match.end()
    return headers

def process_heredocs(command):
    lines = command.splitlines()
    kept_lines = []
    executed = []
    i = 0
    while i < len(lines):
        line = lines[i]
        headers = heredoc_headers(line)
        if not headers:
            kept_lines.append(line)
            i += 1
            continue
        kept_lines.append(line)
        i += 1
        statements = split_statements(line)
        first_tokens = unwrap_command(command_tokens(statements[0])) if statements else []
        first_cmd = basename(first_tokens[0]) if first_tokens else ''
        for delim, is_quoted, strip_tabs in headers:
            body_lines = []
            while i < len(lines) and (lines[i].lstrip('\t') if strip_tabs else lines[i]) != delim:
                body_lines.append(lines[i].lstrip('\t') if strip_tabs else lines[i])
                i += 1
            if i >= len(lines):
                raise ValueError('unterminated heredoc')
            kept_lines.append(lines[i])
            i += 1
            body_text = '\n'.join(body_lines)
            if first_cmd in {'sh', 'bash', 'zsh', 'dash'}:
                executed.append(body_text)
            elif not is_quoted:
                executed.extend(extract_substitutions(body_text, shell_quotes=False))
    return '\n'.join(kept_lines), executed

def split_statements(text):
    statements = []
    current = []
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if ch == '\\' and i + 1 < length:
            if text[i+1] == '\n':
                i += 2
                continue
            current.extend(text[i:i+2])
            i += 2
            continue
        if ch == '#' and (i == 0 or text[i-1].isspace() or text[i-1] in ';|&('):
            end = text.find('\n', i)
            i = length if end == -1 else end
            continue
        if ch in ('"', "'"):
            quote = ch
            current.append(quote)
            i += 1
            while i < length and text[i] != quote:
                if text[i] == '\\' and quote == '"':
                    current.append(text[i])
                    i += 1
                if i < length:
                    current.append(text[i])
                    i += 1
            if i < length:
                current.append(text[i])
                i += 1
            continue
        if ch == '\n' or ch == ';':
            stmt = ''.join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
            i += 1
            continue
        if ch in ('&', '|'):
            next_ch = text[i+1] if i + 1 < length else ''
            stmt = ''.join(current).strip()
            if stmt:
                statements.append(stmt)
            current = []
            if next_ch == ch:
                i += 2
            else:
                i += 1
            continue
        current.append(ch)
        i += 1
    stmt = ''.join(current).strip()
    if stmt:
        statements.append(stmt)
    return statements

def command_tokens(statement):
    lexer = shlex.shlex(statement, posix=True, punctuation_chars='|&;()<>')
    lexer.whitespace_split = True
    lexer.commenters = '#'
    return list(lexer)

def unwrap_command(tokens):
    tokens = list(tokens)
    for _ in range(12):
        if not tokens:
            return tokens
        tok = tokens[0]
        if tok.isdigit() and len(tokens) > 1 and tokens[1] in {'<', '>', '>>', '>&'}:
            tokens = tokens[1:]
            continue
        if tok in {'<', '>', '>>', '>&', '&>'}:
            if len(tokens) < 2:
                raise ValueError('missing redirection operand')
            tokens = tokens[2:]
            continue
        if re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', tok):
            tokens = tokens[1:]
            continue
        name = basename(tok)
        # Verified tool_start projections for filename metadata, not a blanket
        # RTK exemption. Chains/redirections/find-exec still own real reads.
        if name == 'rtk' and len(tokens) > 1 and tokens[1] in {'ls', 'find'}:
            tokens = tokens[1:]
            continue
        if name in {'command', 'builtin', 'exec', 'time', 'nohup', 'then', 'do', 'else', '{', '(', ')'}:
            tokens = tokens[1:]
            if tokens and tokens[0] == '--':
                tokens = tokens[1:]
            continue
        if name not in {'env', 'nice', 'timeout', 'stdbuf', 'sudo'}:
            return tokens
        i = 1
        if name == 'env':
            while i < len(tokens):
                arg = tokens[i]
                if arg in {'--help', '--version', '-h'}:
                    return tokens
                if arg == '--':
                    i += 1
                    break
                if arg in {'-u', '--unset', '-C', '--chdir'}:
                    i += 2
                elif arg in {'-S', '--split-string'}:
                    if i + 1 >= len(tokens):
                        raise ValueError('missing split-string')
                    tokens = [tokens[0]] + shlex.split(tokens[i+1]) + tokens[i+2:]
                    i = 1
                elif arg.startswith('-') or re.match(r'^[A-Za-z_][A-Za-z0-9_]*=', arg):
                    i += 1
                else:
                    break
        else:
            valued = {'-n', '--adjustment'} if name == 'nice' else ({'-s', '--signal', '-k', '--kill-after'} if name == 'timeout' else ({'-i', '-o', '-e', '--input', '--output', '--error'} if name == 'stdbuf' else {'-u', '-g', '-h', '-p', '-C', '-T', '-r', '-t'}))
            while i < len(tokens) and tokens[i].startswith('-'):
                if tokens[i] == '--':
                    i += 1
                    break
                i += 2 if tokens[i] in valued else 1
            if name == 'timeout' and i < len(tokens):
                i += 1
        if i >= len(tokens):
            return tokens
        tokens = tokens[i:]
    raise ValueError('wrapper analysis limit')

def env_statement_dumps_environment(tokens):
    if not tokens or basename(tokens[0]) != 'env':
        return False
    idx = 1
    has_subcommand = False
    while idx < len(tokens):
        tok = tokens[idx]
        if tok in {'-u', '--unset', '-C', '--chdir'}:
            idx += 2
            continue
        if tok in {'-S', '--split-string'}:
            if idx + 1 < len(tokens):
                split_cmd = tokens[idx + 1]
                idx += 2
                if command_dumps_environment(split_cmd):
                    return True
                continue
            idx += 1
            continue
        if tok in {'--help', '-h', '--version'}:
            return False
        if tok.startswith('-') or ('=' in tok and not tok.startswith(('/', './', '../', '~'))):
            idx += 1
            continue
        has_subcommand = True
        sub_tokens = tokens[idx:]
        sub_cmd = basename(sub_tokens[0])
        if sub_cmd == 'set' and (len(sub_tokens) == 1 or not sub_tokens[1].startswith(('-', '+'))):
            return True
        if sub_cmd in {'sh', 'bash', 'zsh', 'dash'}:
            for s_idx, s_tok in enumerate(sub_tokens[1:], 1):
                if s_tok in {'-c', '-lc', '-cl'} and s_idx + 1 < len(sub_tokens):
                    if command_dumps_environment(sub_tokens[s_idx + 1]):
                        return True
        return False
    return not has_subcommand

def command_dumps_environment(command, depth=0):
    if depth > 3:
        raise ValueError('shell analysis depth limit')
    clean_text, executed_subs = process_heredocs(command)
    for sub in executed_subs:
        if command_dumps_environment(sub, depth + 1):
            return True
    for sub in extract_substitutions(clean_text):
        if command_dumps_environment(sub, depth + 1):
            return True

    statements = split_statements(clean_text)
    for stmt in statements:
        if stmt.startswith('#'):
            continue
        inner_stmt = stmt
        while inner_stmt.startswith('(') and inner_stmt.endswith(')'):
            inner_stmt = inner_stmt[1:-1].strip()

        tokens = command_tokens(inner_stmt)
        if not tokens:
            continue

        tokens = unwrap_command(tokens)
        if env_statement_dumps_environment(tokens):
            return True
        while tokens and (tokens[0].isdigit() or tokens[0] in {'>', '>>', '<', '&>'}):
            tokens = tokens[1:] if tokens[0].isdigit() else tokens[2:]
        if not tokens:
            continue
        cmd_tok = tokens[0]
        cmd_name = basename(cmd_tok)
        args = tokens[1:]

        if cmd_name in LITERAL_OUTPUT_COMMANDS:
            continue

        if cmd_name.startswith(('python', 'python3', 'node', 'ruby', 'perl')):
            continue

        if cmd_name == 'printenv' and not any(a in {'--help', '--version', '-h'} for a in args):
            if not args or any(a not in {'PATH', 'HOME', 'PWD', 'SHELL', 'LANG', 'TERM'} for a in args):
                return True
        if cmd_name == 'export' and '-p' in args:
            return True
        if cmd_name == 'declare' and '-x' in args and not any(not a.startswith('-') for a in args):
            return True
        if cmd_name == 'set' and (not args or args[0] in {')', ';', '&&'}):
            return True

        if cmd_name in {'sh', 'bash', 'zsh', 'dash'}:
            for a_idx, a_tok in enumerate(args):
                if a_tok in {'-c', '-lc', '-cl'} and a_idx + 1 < len(args):
                    if command_dumps_environment(args[a_idx + 1], depth + 1):
                        return True
    return False

def command_reads_sensitive_path(command, depth=0):
    if depth > 3:
        raise ValueError('shell analysis depth limit')
    clean_text, executed_subs = process_heredocs(command)
    for sub in executed_subs:
        sens = command_reads_sensitive_path(sub, depth + 1)
        if sens:
            return sens
    for sub in extract_substitutions(clean_text):
        sens = command_reads_sensitive_path(sub, depth + 1)
        if sens:
            return sens

    statements = split_statements(clean_text)
    strip_chars = "'\" ,;&(){}[]<>" + chr(96)
    for stmt in statements:
        if stmt.startswith('#'):
            continue
        inner_stmt = stmt
        while inner_stmt.startswith('(') and inner_stmt.endswith(')'):
            inner_stmt = inner_stmt[1:-1].strip()
        tokens = command_tokens(inner_stmt)
        if not tokens:
            continue

        for i, tok in enumerate(tokens):
            if tok == '<' and i + 1 < len(tokens):
                target = tokens[i+1].strip(strip_chars)
                if is_sensitive_path(target):
                    return target
            elif tok.startswith('<') and len(tok) > 1 and not tok.startswith(('<<', '<(')):
                target = tok[1:].strip(strip_chars)
                if is_sensitive_path(target):
                    return target

        tokens = unwrap_command(tokens)
        while tokens and (tokens[0].isdigit() or tokens[0] in {'>', '>>', '<', '&>'}):
            tokens = tokens[1:] if tokens[0].isdigit() else tokens[2:]
        if not tokens:
            continue
        cmd_tok = tokens[0]
        cmd_name = basename(cmd_tok)
        args = tokens[1:]

        if cmd_name in {'sh', 'bash', 'zsh', 'dash'}:
            for a_idx, a_tok in enumerate(args):
                if a_tok in {'-c', '-lc', '-cl'} and a_idx + 1 < len(args):
                    sens = command_reads_sensitive_path(args[a_idx + 1], depth + 1)
                    if sens:
                        return sens

        if cmd_name in LITERAL_OUTPUT_COMMANDS:
            continue

        if cmd_name in SAFE_METADATA_COMMAND_BASENAMES:
            if cmd_name == 'find':
                if '-exec' in args or '-execdir' in args:
                    exec_flag = '-exec' if '-exec' in args else '-execdir'
                    e_idx = args.index(exec_flag)
                    exec_cmd_toks = args[e_idx + 1:]
                    if exec_cmd_toks:
                        exec_cmd = basename(exec_cmd_toks[0])
                        if exec_cmd in READ_COMMAND_BASENAMES:
                            for t in args:
                                st = t.strip(strip_chars)
                                if is_sensitive_path(st):
                                    return st
            continue

        is_rg_search = cmd_name in {'rg', 'grep'}
        if cmd_name == 'rtk' and args and args[0] == 'rg':
            is_rg_search = True
            args = args[1:]

        if is_rg_search:
            pattern_already_found = False
            pos_args = []
            a_i = 0
            options = True
            while a_i < len(args):
                arg = args[a_i]
                if options and arg.startswith('--pre') and (arg == '--pre' or arg.startswith('--pre=')):
                    raise ValueError('external search preprocessors are unsupported')
                if options and arg.startswith('-') and not arg.startswith('--'):
                    # -nf FILE and -ne PATTERN have the same operand roles as
                    # separate flags. Do not consume a pattern file as data.
                    cluster = re.fullmatch(r'-[niFEGHhvlLcoqsrRaIUwxbzZNSu]*([ef])(.*)', arg)
                    if cluster and len(arg) > 2:
                        flag, attached = cluster.groups()
                        args[a_i:a_i+1] = ['-' + flag] + ([attached] if attached else [])
                        arg = args[a_i]
                if options and arg == '--':
                    options = False
                    a_i += 1
                    continue
                if not options:
                    if pattern_already_found:
                        pos_args.append(arg)
                    else:
                        pattern_already_found = True
                    a_i += 1
                    continue
                if arg in {'-e', '--regexp'}:
                    pattern_already_found = True
                    if a_i + 1 < len(args):
                        a_i += 2
                        continue
                    a_i += 1
                    continue
                if (arg.startswith('-e') and not arg.startswith('--')) or arg.startswith('--regexp='):
                    pattern_already_found = True
                    a_i += 1
                    continue
                if arg in {'-f', '--file', '--ignore-file', '--exclude-from'}:
                    if arg in {'-f', '--file'}:
                        pattern_already_found = True
                    if a_i + 1 < len(args):
                        f_val = args[a_i + 1].strip(strip_chars)
                        if is_sensitive_path(f_val):
                            return f_val
                        a_i += 2
                        continue
                    a_i += 1
                    continue
                if (arg.startswith('-f') and not arg.startswith('--')) or arg.startswith(('--file=', '--ignore-file=', '--exclude-from=')):
                    if arg.startswith('-f') and not arg.startswith('--') or arg.startswith('--file='):
                        pattern_already_found = True
                    parts = arg.split('=', 1)
                    val = parts[1] if len(parts) > 1 else arg[2:]
                    if is_sensitive_path(val.strip(strip_chars)):
                        return val.strip(strip_chars)
                    a_i += 1
                    continue
                if arg in {'-C', '-A', '-B', '-m', '--context', '--after-context', '--before-context', '--max-count'}:
                    a_i += 2
                    continue
                if arg.startswith(('-C', '-A', '-B', '-m')):
                    a_i += 1
                    continue
                if arg.startswith('-'):
                    a_i += 1
                    continue
                if not pattern_already_found:
                    pattern_already_found = True
                else:
                    pos_args.append(arg)
                a_i += 1
            for p in pos_args:
                sp = p.strip(strip_chars)
                if is_sensitive_path(sp):
                    return sp
            continue

        if cmd_name in READ_COMMAND_BASENAMES:
            for a in args:
                if a.startswith('-'):
                    continue
                sa = a.strip(strip_chars)
                if is_sensitive_path(sa):
                    return sa
            continue

        for a in args:
            if a.startswith('-'):
                continue
            sa = a.strip(strip_chars)
            pathlike = '/' in sa or '\\' in sa or sa.startswith(('~', '.')) or basename(sa).startswith('.')
            if is_sensitive_path(sa):
                return sa
    return None

def check(tool_name, tool_input):
    if not isinstance(tool_input, dict):
        return 'malformed tool input'
    tool_name = (tool_name or '').lower().split('.')[-1]

    if tool_name == 'mh_npm_config':
        for k in tool_input:
            if k != 'path':
                return 'mh_npm_config accepts no additional properties'
        path_val = tool_input.get('path')
        if 'path' in tool_input:
            if not isinstance(path_val, str) or '\0' in path_val or basename(path_val) != '.npmrc':
                return 'mh_npm_config path must be an exact .npmrc'
        return None

    if tool_name == 'mh_env_config':
        for k in tool_input:
            if k != 'path':
                return 'mh_env_config accepts no additional properties'
        path_val = tool_input.get('path')
        if 'path' in tool_input:
            if not isinstance(path_val, str) or '\0' in path_val or not path_val:
                return 'mh_env_config path must be a nonempty string'
            bname = basename(path_val).lower()
            if not (bname == '.env' or (bname.startswith('.env.') and len(bname) <= 64 and bool(re.fullmatch(r'\.env\.[a-z0-9_.-]+', bname)))):
                return 'mh_env_config path must be .env or .env.<suffix>'
        return None

    if tool_name == 'mh_pypi_config':
        for k in tool_input:
            if k != 'path':
                return 'mh_pypi_config accepts no additional properties'
        path_val = tool_input.get('path')
        if 'path' in tool_input:
            if not isinstance(path_val, str) or '\0' in path_val or basename(path_val) != '.pypirc':
                return 'mh_pypi_config path must be an exact .pypirc'
        return None

    if tool_name == 'mh_certificate_info':
        for k in tool_input:
            if k != 'path':
                return 'mh_certificate_info accepts no additional properties'
        if 'path' not in tool_input:
            return 'mh_certificate_info path is required'
        path_val = tool_input['path']
        if not isinstance(path_val, str) or '\0' in path_val or not path_val:
            return 'mh_certificate_info path must be a nonempty string'
        if not path_val.lower().endswith('.pem'):
            return 'mh_certificate_info path must end in .pem'
        return None

    if tool_name in {'read', 'readfile', 'read_file', 'view_file'}:
        targets = []
        found_target = False
        for k, v in tool_input.items():
            lk = k.lower().replace('-', '_')
            if lk in {'file_path', 'filepath', 'path', 'filename', 'file', 'target_path', 'target_file', 'targetfile'}:
                found_target = True
                if isinstance(v, str) and v:
                    targets.append(v)
                else:
                    return 'Read tool target path must be a string'
            elif lk in {'files', 'paths', 'file_paths'}:
                found_target = True
                if isinstance(v, list) and all(isinstance(x, str) for x in v):
                    targets.extend(v)
                else:
                    return 'Read tool target files must be an array of strings'
        if not found_target:
            return 'Read tool missing target path'
        for t in targets:
            if is_sensitive_path(t):
                return 'Read tool attempted to read a sensitive file'
        return None

    if tool_name in {'grep', 'grep_search', 'search', 'file_search', 'ripgrep'}:
        targets = []
        for k, v in tool_input.items():
            lk = k.lower().replace('-', '_')
            if lk in {'path', 'paths', 'dir_path', 'directory', 'file_path', 'target_directory', 'cwd'}:
                if isinstance(v, str):
                    targets.append(v)
                elif isinstance(v, list) and all(isinstance(x, str) for x in v):
                    targets.extend(v)
                else:
                    return 'search tool target path has invalid shape'
            elif lk in {'files', 'file_paths'}:
                if isinstance(v, list) and all(isinstance(x, str) for x in v):
                    targets.extend(v)
                elif isinstance(v, str):
                    targets.append(v)
                else:
                    return 'search tool target files have invalid shape'
        for t in targets:
            if is_sensitive_path(t):
                return 'search tool attempted to access a sensitive path'
        return None

    if tool_name in {'glob', 'glob_tool', 'list_dir', 'list_files', 'file_list', 'find_files'}:
        return None

    if tool_name in {'apply_patch', 'applypatch'}:
        patch = tool_input.get('input', tool_input.get('patch'))
        if not isinstance(patch, str):
            return 'patch tool missing patch text'
        for target in re.findall(r'^\*\*\* (?:Update|Delete) File: (.+)$', patch, re.MULTILINE):
            if is_sensitive_path(target.strip()):
                return 'patch tool attempted to access a sensitive target'
        return None

    if tool_name in {'write_to_file', 'write_file', 'create_file', 'write'}:
        return None

    if tool_name in {'edit', 'edit_file', 'replace_file_content', 'str_replace_editor'}:
        targets = []
        for k, v in tool_input.items():
            lk = k.lower().replace('-', '_')
            if lk in {'file_path', 'filepath', 'path', 'filename', 'target_file', 'targetfile'}:
                if isinstance(v, str) and v:
                    targets.append(v)
                else:
                    return 'Edit tool target path must be a nonempty string'
        if not targets:
            return 'Edit tool missing target path'
        for t in targets:
            if is_sensitive_path(t):
                return 'Edit tool attempted to access a sensitive file'
        return None

    if tool_name in {'bash', 'shellcommand', 'shell_command', 'exec_command'}:
        command = tool_input.get('command') or tool_input.get('cmd')
        if isinstance(command, list):
            command = ' '.join(str(part) for part in command)
        if not isinstance(command, str):
            return 'malformed shell input'
        try:
            if command_dumps_environment(command):
                return 'command may dump process environment'
            if command_reads_sensitive_path(command):
                return 'command appears to read sensitive material'
        except ValueError:
            return 'command exceeds supported shell syntax or analysis bounds'
        return None

    TARGET_KEYS = {
        'path', 'paths', 'file_path', 'filepath', 'file_paths', 'filename', 'filenames',
        'target_path', 'target_file', 'targetfile', 'file', 'files', 'dir', 'directory', 'dir_path', 'folder'
    }
    NON_TARGET_KEYS = {
        'description', 'explanation', 'content', 'patch', 'query', 'pattern', 'prompt',
        'text', 'diff', 'message', 'comment', 'instruction', 'replacement', 'replacementcontent',
        'codecontent', 'targetcontent', 'body', 'data'
    }

    def check_fallback(obj, depth=0):
        if depth > 4:
            return 'tool arguments exceed bounded target-path analysis'
        if isinstance(obj, dict):
            for k, v in obj.items():
                lk = k.lower().replace('-', '_')
                if lk in NON_TARGET_KEYS or lk.endswith(('_text', '_content', '_query', '_pattern', '_description')):
                    continue
                if lk in TARGET_KEYS or lk.endswith(('_path', '_file', '_filepath', '_filename')):
                    if isinstance(v, str):
                        if is_sensitive_path(v):
                            return 'tool attempted to access a sensitive file'
                    elif isinstance(v, list):
                        for item in v:
                            if isinstance(item, str) and is_sensitive_path(item):
                                return 'tool attempted to access a sensitive file'
                if isinstance(v, (dict, list)):
                    issue = check_fallback(v, depth + 1)
                    if issue:
                        return issue
        elif isinstance(obj, list):
            for item in obj:
                if isinstance(item, (dict, list)):
                    issue = check_fallback(item, depth + 1)
                    if issue:
                        return issue
        return None

    return check_fallback(tool_input)

if __name__ == '__main__':
    payload = json.load(sys.stdin)
    issue = check(payload['tool_name'], payload['tool_input'])
    sys.stdout.write(json.dumps({'issue': issue}))
`;

const FAILURE = { decision: "deny", reason: "Mahiro secret-read guard unavailable or invalid input; tool blocked." };
const MAX_INPUT = 1024 * 1024;

const CHECKER_TIMEOUT_MS = 10_000;

function createChecker({ signal, python = "/usr/bin/python3", timeoutMs = CHECKER_TIMEOUT_MS, env } = {}) {
  const pending = new Set();
  let disposed = false;
  const stop = () => {
    disposed = true;
    for (const cancel of [...pending]) cancel();
  };
  signal?.addEventListener?.("abort", stop, { once: true });
  return {
    async check(event) {
      // No approval cache: evaluate each phase's final args independently.
      if (disposed || signal?.aborted) return FAILURE;
      let input;
      try {
        if (!event || !["approval", "execution"].includes(event.phase)
          || typeof event.toolName !== "string" || !event.toolName
          || !event.args || typeof event.args !== "object" || Array.isArray(event.args)) return FAILURE;
        const toolName = event.toolName.split(".").at(-1);
        input = JSON.stringify({ tool_name: toolName, tool_input: event.args });
        if (Buffer.byteLength(input) > MAX_INPUT) return FAILURE;
      } catch {
        return FAILURE;
      }
      return new Promise((resolve) => {
        let child;
        let timer;
        let settled = false;
        let output = "";
        const finish = (result) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pending.delete(cancel);
          resolve(result);
        };
        const killGroup = () => {
          if (child?.pid) {
            try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
          }
        };
        const cancel = () => {
          killGroup();
          finish(FAILURE);
        };
        pending.add(cancel);
        try {
          child = spawn(python, ["-I", "-c", POLICY], {
            cwd: event.cwd || event.workingDirectory || process.cwd(),
            env: env ?? process.env,
            detached: true,
            stdio: ["pipe", "pipe", "ignore"],
          });
          timer = setTimeout(cancel, timeoutMs);
          child.on("error", () => finish(FAILURE));
          child.stdin.on("error", cancel);
          child.stdout.on("data", (chunk) => {
            output += chunk.toString("utf8");
            if (output.length > 4096) cancel();
          });
          child.on("close", (code) => {
            killGroup();
            if (code !== 0) return finish(FAILURE);
            try {
              const result = JSON.parse(output);
              if (result.issue === null) finish(undefined);
              else if (typeof result.issue === "string" && result.issue.length <= 512) {
                finish({ decision: "deny", reason: `Mahiro secret-read guard: ${result.issue}.` });
              } else finish(FAILURE);
            } catch { finish(FAILURE); }
          });
          child.stdin.end(input);
        } catch { cancel(); }
      });
    },
    dispose() {
      stop();
      signal?.removeEventListener?.("abort", stop);
    },
  };
}

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_CONFIG_LINES = 500;
const MAX_PAYLOAD_BYTES = 32 * 1024;

const BOOLEAN_SETTINGS = new Set([
  "strict-ssl", "save-exact", "package-lock", "fund", "audit", "ignore-scripts",
  "legacy-peer-deps", "auto-install-peers", "prefer-offline", "prefer-online",
  "engine-strict", "dry-run", "shamefully-hoist", "hoist",
]);

const ENUMERATED_SETTINGS = new Map([
  ["node-linker", new Set(["hoisted", "isolated", "pnp", "pnp-loose"])],
  ["loglevel", new Set(["silent", "error", "warn", "notice", "http", "info", "verbose", "silly"])],
]);

const NUMBER_SETTINGS = new Set([
  "fetch-retries", "fetch-retry-mintimeout", "fetch-retry-maxtimeout",
  "fetch-timeout", "maxsockets", "depth",
]);

async function readConfigFileLines(targetPath, signal) {
  if (signal?.aborted) return { status: "error", error: "Operation aborted." };
  let handle;
  let rawContent;
  try {
    if (typeof constants.O_NOFOLLOW !== "number") {
      return { status: "error", error: "Safe configuration reading is unsupported on this platform." };
    }
    // Inspect and read ONE descriptor, never re-resolve a path after checking it.
    // NONBLOCK prevents a replaced FIFO/device from hanging before fstat.
    handle = await open(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (signal?.aborted) return { status: "error", error: "Operation aborted." };
    const stat = await handle.stat();
    if (!stat.isFile()) return { status: "error", error: "Target is not a regular file." };
    if (stat.size > MAX_CONFIG_BYTES) return { status: "error", error: "File exceeds maximum supported size (64KB)." };
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      if (signal?.aborted) return { status: "error", error: "Operation aborted." };
      const { bytesRead } = await handle.read(buffer, length, Math.min(4096, buffer.length - length), length);
      if (signal?.aborted) return { status: "error", error: "Operation aborted." };
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await handle.stat();
    if (length > MAX_CONFIG_BYTES || after.size > MAX_CONFIG_BYTES) {
      return { status: "error", error: "File exceeds maximum supported size (64KB)." };
    }
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
      return { status: "error", error: "Configuration changed during inspection; retry." };
    }
    rawContent = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
    if (rawContent.includes("\0")) return { status: "error", error: "Unsupported configuration encoding." };
  } catch (error) {
    if (error?.code === "ELOOP") return { status: "error", error: "Refusing to read symbolic link." };
    return { status: "error", error: "Failed to read file." };
  } finally {
    await handle?.close().catch(() => {});
  }
  if (signal?.aborted) return { status: "error", error: "Operation aborted." };

  const lines = rawContent.split(/\r?\n/);
  if (lines.length > MAX_CONFIG_LINES) {
    return { status: "error", error: "File exceeds maximum line count (500 lines)." };
  }

  return { status: "success", lines };
}

async function runNpmConfig(ctx) {
  if (ctx?.signal?.aborted) return { status: "error", error: "Operation aborted." };
  if (!ctx || typeof ctx.cwd !== "string" || !isAbsolute(ctx.cwd)
    || !ctx.args || typeof ctx.args !== "object" || Array.isArray(ctx.args)
    || Object.keys(ctx.args).some((key) => key !== "path")) {
    return { status: "error", error: "Valid scoped cwd and config arguments are required." };
  }
  const cwd = ctx.cwd;
  const rawPath = ctx?.args?.path;
  if (rawPath !== undefined && typeof rawPath !== "string") {
    return { status: "error", error: "Argument path must be a string." };
  }
  if (rawPath !== undefined && !rawPath) {
    return { status: "error", error: "Argument path must be nonempty." };
  }
  const targetPath = rawPath === undefined ? resolve(cwd, ".npmrc") : resolve(cwd, rawPath);
  if (basename(targetPath) !== ".npmrc") {
    return { status: "error", error: "Target file basename must be exactly .npmrc." };
  }

  const readRes = await readConfigFileLines(targetPath, ctx?.signal);
  if (readRes.status !== "success") return readRes;
  const lines = readRes.lines;

  const settings = {};
  let redacted_count = 0;
  const redacted_reasons = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    if (line.trimEnd().endsWith("\\")) {
      return { status: "error", error: "Multiline continuation lines in .npmrc are not supported." };
    }
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      return { status: "error", error: "Malformed line in .npmrc without '=' separator." };
    }
    const rawKey = line.slice(0, eqIdx).trim();
    let rawVal = line.slice(eqIdx + 1).trim();
    if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
      const quote = rawVal[0];
      if (!rawVal.endsWith(quote) || rawVal.length < 2) {
        return { status: "error", error: "Malformed quoted configuration value." };
      }
      rawVal = rawVal.slice(1, -1);
    }
    if (!rawKey) {
      return { status: "error", error: "Malformed line in .npmrc with empty key." };
    }

    const lk = rawKey.toLowerCase();

    // Auth / credential keys
    if (
      lk.includes("auth") || lk.includes("token") || lk.includes("password") ||
      lk.includes("secret") || lk.includes("key") || lk.includes("cert") ||
      lk.includes("credentials") || lk.startsWith("_") || lk.includes(":_")
    ) {
      redacted_count += 1;
      redacted_reasons.add("credential_key");
      continue;
    }

    // Boolean settings
    if (BOOLEAN_SETTINGS.has(lk)) {
      const lv = rawVal.toLowerCase();
      if (lv === "true" || lv === "false") {
        settings[lk] = lv === "true";
      } else {
        redacted_count += 1;
        redacted_reasons.add("invalid_boolean_value");
      }
      continue;
    }

    // Enumerated settings
    if (ENUMERATED_SETTINGS.has(lk)) {
      const lv = rawVal.toLowerCase();
      if (ENUMERATED_SETTINGS.get(lk).has(lv)) {
        settings[lk] = lv;
      } else {
        redacted_count += 1;
        redacted_reasons.add("invalid_enumerated_value");
      }
      continue;
    }

    // Number settings
    if (NUMBER_SETTINGS.has(lk)) {
      if (/^\d+$/.test(rawVal) && Number.isSafeInteger(Number(rawVal))) {
        settings[lk] = Number(rawVal);
      } else {
        redacted_count += 1;
        redacted_reasons.add("invalid_number_value");
      }
      continue;
    }

    // Registry settings (registry or @scope:registry)
    if (lk === "registry" || /^@[a-z0-9_.-]+:registry$/.test(lk)) {
      try {
        const u = new URL(rawVal);
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          redacted_count += 1;
          redacted_reasons.add("unsupported_registry_protocol");
          continue;
        }
        // Safe origin strips username, password, pathname, search, hash
        settings[lk] = u.origin;
      } catch {
        redacted_count += 1;
        redacted_reasons.add("malformed_registry_url");
      }
      continue;
    }

    // Unrecognized / unvalidated setting
    redacted_count += 1;
    redacted_reasons.add("unrecognized_setting");
  }

  return {
    status: "success",
    settings,
    redacted_count,
    redacted_reasons: Array.from(redacted_reasons).sort(),
    lines_parsed: lines.length,
  };
}

function isPlaceholderLike(val) {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if ((trimmed.startsWith("<") && trimmed.endsWith(">")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("${") && trimmed.endsWith("}"))) {
    return true;
  }
  if (/^\$[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) return true;
  if (/^[xX*.-]{3,}$/.test(trimmed)) return true;
  const lower = trimmed.toLowerCase();
  if (/^(?:your[_-]|insert[_-]|replace[_-]|change[_-]?me|placeholder|todo|fixme|dummy[_-]|sample[_-]|example[_-])/i.test(lower)) return true;
  if (/^(?:changeme|placeholder|todo|fixme|dummy|sample|example)$/i.test(lower)) return true;
  if (/(?:[_-]here|[_-]placeholder|[_-]sample|[_-]example|[_-]token|[_-]key)$/i.test(lower)) return true;
  return false;
}

async function runEnvConfig(ctx) {
  if (ctx?.signal?.aborted) return { status: "error", error: "Operation aborted." };
  if (!ctx || typeof ctx.cwd !== "string" || !isAbsolute(ctx.cwd)
    || !ctx.args || typeof ctx.args !== "object" || Array.isArray(ctx.args)
    || Object.keys(ctx.args).some((key) => key !== "path")) {
    return { status: "error", error: "Valid scoped cwd and config arguments are required." };
  }
  const cwd = ctx.cwd;
  const rawPath = ctx?.args?.path;
  if (rawPath !== undefined && typeof rawPath !== "string") {
    return { status: "error", error: "Argument path must be a string." };
  }
  if (rawPath !== undefined && !rawPath) {
    return { status: "error", error: "Argument path must be nonempty." };
  }
  const targetPath = rawPath === undefined ? resolve(cwd, ".env") : resolve(cwd, rawPath);
  const bname = basename(targetPath).toLowerCase();
  if (bname !== ".env" && (!/^\.env\.[a-z0-9_.-]+$/i.test(bname) || bname.length > 64)) {
    return { status: "error", error: "Target file basename must be .env or .env.<suffix>." };
  }

  const readRes = await readConfigFileLines(targetPath, ctx?.signal);
  if (readRes.status !== "success") return readRes;
  const lines = readRes.lines;

  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xFEFF) {
    lines[0] = lines[0].slice(1);
  }

  const keyMap = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (line.trimEnd().endsWith("\\")) {
      return { status: "error", error: "Multiline continuation lines in dotenv are not supported." };
    }

    let content = trimmed;
    if (content.startsWith("export") && (content.length === 6 || /\s/.test(content[6]))) {
      content = content.slice(6).trimStart();
    }

    const eqIdx = content.indexOf("=");
    if (eqIdx === -1) {
      return { status: "error", error: "Malformed line in dotenv file without '=' separator." };
    }

    const rawKey = content.slice(0, eqIdx).trim();
    if (!rawKey) {
      return { status: "error", error: "Malformed line in dotenv file with empty key." };
    }
    if (rawKey.length > 128 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(rawKey)) {
      return { status: "error", error: "Malformed or unsupported key name in dotenv file." };
    }

    const rawVal = content.slice(eqIdx + 1).trim();
    let parsedVal = "";

    if (rawVal.startsWith('"')) {
      let j = 1;
      const valChars = [];
      let closed = false;
      while (j < rawVal.length) {
        if (rawVal[j] === "\\" && j + 1 < rawVal.length) {
          valChars.push(rawVal[j + 1]);
          j += 2;
          continue;
        }
        if (rawVal[j] === '"') {
          closed = true;
          j += 1;
          break;
        }
        valChars.push(rawVal[j]);
        j += 1;
      }
      if (!closed) {
        return { status: "error", error: "Malformed quoted configuration value in dotenv file." };
      }
      const remainder = rawVal.slice(j).trim();
      if (remainder && !remainder.startsWith("#")) {
        return { status: "error", error: "Malformed content following quoted value in dotenv file." };
      }
      parsedVal = valChars.join("");
    } else if (rawVal.startsWith("'")) {
      let j = 1;
      const valChars = [];
      let closed = false;
      while (j < rawVal.length) {
        if (rawVal[j] === "'") {
          closed = true;
          j += 1;
          break;
        }
        valChars.push(rawVal[j]);
        j += 1;
      }
      if (!closed) {
        return { status: "error", error: "Malformed quoted configuration value in dotenv file." };
      }
      const remainder = rawVal.slice(j).trim();
      if (remainder && !remainder.startsWith("#")) {
        return { status: "error", error: "Malformed content following quoted value in dotenv file." };
      }
      parsedVal = valChars.join("");
    } else {
      // Unquoted # starts a comment, including an otherwise empty value.
      // Quotes inside comment prose are not part of the value grammar.
      const commentIndex = rawVal.indexOf("#");
      const value = (commentIndex === -1 ? rawVal : rawVal.slice(0, commentIndex)).trim();
      if (value.includes('"') || value.includes("'")) {
        return { status: "error", error: "Malformed quoting in dotenv file." };
      }
      parsedVal = value;
    }

    const present = parsedVal.length > 0;
    const placeholder_like = present ? isPlaceholderLike(parsedVal) : false;

    keyMap.set(rawKey, {
      name: rawKey,
      present,
      placeholder_like,
    });
  }

  const result = {
    status: "success",
    keys: Array.from(keyMap.values()),
    lines_parsed: lines.length,
  };

  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PAYLOAD_BYTES) {
    return { status: "error", error: "Output exceeds maximum supported size (32KB)." };
  }

  return result;
}

async function runPypiConfig(ctx) {
  if (ctx?.signal?.aborted) return { status: "error", error: "Operation aborted." };
  if (!ctx || typeof ctx.cwd !== "string" || !isAbsolute(ctx.cwd)
    || !ctx.args || typeof ctx.args !== "object" || Array.isArray(ctx.args)
    || Object.keys(ctx.args).some((key) => key !== "path")) {
    return { status: "error", error: "Valid scoped cwd and config arguments are required." };
  }
  const cwd = ctx.cwd;
  const rawPath = ctx?.args?.path;
  if (rawPath !== undefined && typeof rawPath !== "string") {
    return { status: "error", error: "Argument path must be a string." };
  }
  if (rawPath !== undefined && !rawPath) {
    return { status: "error", error: "Argument path must be nonempty." };
  }
  const targetPath = rawPath === undefined ? resolve(cwd, ".pypirc") : resolve(cwd, rawPath);
  if (basename(targetPath) !== ".pypirc") {
    return { status: "error", error: "Target file basename must be exactly .pypirc." };
  }

  const readRes = await readConfigFileLines(targetPath, ctx?.signal);
  if (readRes.status !== "success") return readRes;
  const lines = readRes.lines;

  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xFEFF) {
    lines[0] = lines[0].slice(1);
  }

  let currentSection = null;
  const indexServers = [];
  const repositories = new Map();
  let redacted_count = 0;
  const redacted_reasons = new Set();
  let inMultilineIndexServers = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isIndented = line.startsWith(" ") || line.startsWith("\t");
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

    if (line.trimEnd().endsWith("\\")) {
      return { status: "error", error: "Multiline continuation lines in .pypirc are not supported." };
    }

    if (isIndented) {
      if (inMultilineIndexServers && currentSection === "distutils") {
        const entries = trimmed.split(/[\s,]+/).filter(Boolean);
        for (const entry of entries) {
          if (!/^[a-zA-Z0-9_.-]+$/.test(entry) || entry.length > 64) {
            return { status: "error", error: "Malformed index-servers entry in .pypirc." };
          }
          if (!indexServers.includes(entry)) {
            indexServers.push(entry);
          }
        }
        continue;
      }
      return { status: "error", error: "Unexpected indented line in .pypirc." };
    }

    inMultilineIndexServers = false;

    if (trimmed.startsWith("[")) {
      if (!trimmed.endsWith("]") || trimmed.indexOf("]", 1) !== trimmed.length - 1) {
        return { status: "error", error: "Malformed section header in .pypirc." };
      }
      const secName = trimmed.slice(1, -1).trim();
      if (!secName || !/^[a-zA-Z0-9_.-]+$/.test(secName) || secName.length > 64) {
        return { status: "error", error: "Malformed section header in .pypirc." };
      }
      currentSection = secName;
      if (currentSection !== "distutils" && !repositories.has(currentSection)) {
        repositories.set(currentSection, {});
      }
      continue;
    }

    if (currentSection === null) {
      return { status: "error", error: "Properties found outside section in .pypirc." };
    }

    const eqIdx = trimmed.search(/[=:]/);
    if (eqIdx === -1) {
      return { status: "error", error: "Malformed line in .pypirc without separator." };
    }

    const rawKey = trimmed.slice(0, eqIdx).trim();
    let rawVal = trimmed.slice(eqIdx + 1).trim();
    if (!rawKey || !/^[a-zA-Z0-9_.-]+$/.test(rawKey) || rawKey.length > 64) {
      return { status: "error", error: "Malformed key name in .pypirc." };
    }

    const lk = rawKey.toLowerCase();

    if (currentSection === "distutils") {
      if (lk === "index-servers") {
        inMultilineIndexServers = true;
        if (rawVal) {
          const entries = rawVal.split(/[\s,]+/).filter(Boolean);
          for (const entry of entries) {
            if (!/^[a-zA-Z0-9_.-]+$/.test(entry) || entry.length > 64) {
              return { status: "error", error: "Malformed index-servers entry in .pypirc." };
            }
            if (!indexServers.includes(entry)) {
              indexServers.push(entry);
            }
          }
        }
      } else {
        redacted_count += 1;
        redacted_reasons.add("unrecognized_setting");
      }
      continue;
    }

    // Repository profile section
    if (
      lk === "username" || lk === "password" || lk === "token" ||
      lk.includes("auth") || lk.includes("token") || lk.includes("password") ||
      lk.includes("secret") || lk.includes("key") || lk.includes("credentials")
    ) {
      redacted_count += 1;
      redacted_reasons.add("credential_key");
      continue;
    }

    if (lk === "repository") {
      if (rawVal.startsWith('"') || rawVal.startsWith("'")) {
        const q = rawVal[0];
        if (!rawVal.endsWith(q) || rawVal.length < 2) {
          return { status: "error", error: "Malformed quoted configuration value in .pypirc." };
        }
        rawVal = rawVal.slice(1, -1);
      }
      try {
        const u = new URL(rawVal);
        if (u.protocol !== "https:" && u.protocol !== "http:") {
          redacted_count += 1;
          redacted_reasons.add("unsupported_repository_protocol");
          continue;
        }
        repositories.get(currentSection).repository = u.origin;
      } catch {
        redacted_count += 1;
        redacted_reasons.add("malformed_repository_url");
      }
      continue;
    }

    redacted_count += 1;
    redacted_reasons.add("unrecognized_setting");
  }

  const result = {
    status: "success",
    index_servers: indexServers,
    // fromEntries defines OWN properties even for __proto__/constructor; no
    // arbitrary section name is ever assigned through a prototype setter.
    repositories: Object.fromEntries(repositories),
    redacted_count,
    redacted_reasons: Array.from(redacted_reasons).sort(),
    lines_parsed: lines.length,
  };

  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PAYLOAD_BYTES) {
    return { status: "error", error: "Output exceeds maximum supported size (32KB)." };
  }

  return result;
}

const MAX_CERTIFICATE_BLOCKS = 16;

async function runCertificateInfo(ctx) {
  if (ctx?.signal?.aborted) return { status: "error", error: "Operation aborted." };
  if (!ctx || typeof ctx.cwd !== "string" || !isAbsolute(ctx.cwd)
    || !ctx.args || typeof ctx.args !== "object" || Array.isArray(ctx.args)
    || Object.keys(ctx.args).some((key) => key !== "path")) {
    return { status: "error", error: "Valid scoped cwd and certificate arguments are required." };
  }
  const rawPath = ctx?.args?.path;
  if (typeof rawPath !== "string") {
    return { status: "error", error: "Argument path must be a string." };
  }
  if (!rawPath) {
    return { status: "error", error: "Argument path must be nonempty." };
  }
  if (rawPath.includes("\0")) {
    return { status: "error", error: "Argument path contains invalid characters." };
  }
  const targetPath = resolve(ctx.cwd, rawPath);
  const targetBasename = basename(targetPath).toLowerCase();
  if (!targetBasename.endsWith(".pem")) {
    return { status: "error", error: "Target file basename must end in .pem." };
  }

  const readRes = await readConfigFileLines(targetPath, ctx?.signal);
  if (readRes.status !== "success") return readRes;
  const lines = readRes.lines;

  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xFEFF) {
    lines[0] = lines[0].slice(1);
  }

  const certificates = [];
  let inBlock = false;
  let currentBase64Lines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!inBlock) {
      if (!trimmed) continue;
      if (trimmed === "-----BEGIN CERTIFICATE-----") {
        if (certificates.length >= MAX_CERTIFICATE_BLOCKS) {
          return { status: "error", error: "Certificate chain exceeds maximum supported limit (16 certificates)." };
        }
        inBlock = true;
        currentBase64Lines = [];
        continue;
      }
      return { status: "error", error: "Invalid certificate format." };
    } else {
      if (trimmed === "-----END CERTIFICATE-----") {
        if (currentBase64Lines.length === 0) {
          return { status: "error", error: "Invalid certificate format." };
        }
        const b64 = currentBase64Lines.join("");
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 !== 0) {
          return { status: "error", error: "Invalid certificate format." };
        }
        let der;
        try {
          der = Buffer.from(b64, "base64");
        } catch {
          return { status: "error", error: "Invalid certificate format." };
        }
        if (der.toString("base64") !== b64) {
          return { status: "error", error: "Invalid certificate format." };
        }
        let cert;
        try {
          cert = new X509Certificate(der);
        } catch {
          return { status: "error", error: "Invalid certificate format." };
        }
        if (!cert.raw || !der.equals(cert.raw)) {
          return { status: "error", error: "Invalid certificate format." };
        }
        certificates.push({
          subject: cert.subject,
          issuer: cert.issuer,
          valid_from: cert.validFrom,
          valid_to: cert.validTo,
          fingerprint256: cert.fingerprint256,
          serial_number: cert.serialNumber.toUpperCase(),
        });
        inBlock = false;
        currentBase64Lines = [];
        continue;
      }

      if (!trimmed || !/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
        return { status: "error", error: "Invalid certificate format." };
      }
      currentBase64Lines.push(trimmed);
    }
  }

  if (inBlock) {
    return { status: "error", error: "Invalid certificate format." };
  }

  if (certificates.length === 0) {
    return { status: "error", error: "No certificates found in target file." };
  }

  const result = {
    status: "success",
    certificates,
    certificate_count: certificates.length,
  };

  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PAYLOAD_BYTES) {
    return { status: "error", error: "Output exceeds maximum supported size (32KB)." };
  }

  if (ctx?.signal?.aborted) return { status: "error", error: "Operation aborted." };

  return result;
}

const NPM_CONFIG_TOOL = {
  name: "mh_npm_config",
  description: "Inspect workspace .npmrc configuration with auth and sensitive tokens strictly filtered out.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to .npmrc file (optional, defaults to .npmrc in workspace cwd). Basename must be exactly .npmrc.",
      },
    },
    additionalProperties: false,
  },
  requiresApproval: false,
  parallelSafe: true,
  run: (ctx) => runNpmConfig(ctx),
};

const ENV_CONFIG_TOOL = {
  name: "mh_env_config",
  description: "Inspect workspace dotenv (.env) configuration keys and presence without exposing values.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to .env file (optional, defaults to .env in workspace cwd). Basename must be .env or .env.<suffix>.",
      },
    },
    additionalProperties: false,
  },
  requiresApproval: false,
  parallelSafe: true,
  run: (ctx) => runEnvConfig(ctx),
};

const PYPI_CONFIG_TOOL = {
  name: "mh_pypi_config",
  description: "Inspect workspace PyPI configuration (.pypirc) with auth tokens and passwords strictly filtered out.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to .pypirc file (optional, defaults to .pypirc in workspace cwd). Basename must be exactly .pypirc.",
      },
    },
    additionalProperties: false,
  },
  requiresApproval: false,
  parallelSafe: true,
  run: (ctx) => runPypiConfig(ctx),
};

const CERTIFICATE_INFO_TOOL = {
  name: "mh_certificate_info",
  description: "Inspect public X.509 certificate metadata from a .pem file safely without exposing raw PEM or private keys.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to .pem certificate file. Basename must end in .pem (case-insensitive).",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  requiresApproval: false,
  parallelSafe: true,
  run: (ctx) => runCertificateInfo(ctx),
};

export default function activate(letta) {
  if (letta.signal?.aborted) return;
  const hasPermissions = Boolean(letta.capabilities?.permissions && typeof letta.permissions?.register === "function");
  const hasTools = Boolean(letta.capabilities?.tools && typeof letta.tools?.register === "function");
  if (!hasPermissions && !hasTools) {
    letta.diagnostics?.report?.({ severity: "error", message: "Mahiro secret-read guard inactive: permissions capability unavailable. Keep the existing hook enabled." });
    return;
  }
  if (!hasPermissions) {
    letta.diagnostics?.report?.({ severity: "error", message: "Mahiro secret-read guard inactive: permissions capability unavailable. Keep the existing hook enabled." });
  }
  const checker = hasPermissions ? createChecker({ signal: letta.signal }) : null;
  const unregisters = [];
  const guardLifetime = new AbortController();
  let disposed = false;
  if (hasPermissions) {
    try {
      unregisters.push(letta.permissions.register({
        id: "mahiro-secret-read-guard",
        description: "Deny secret reads and environment dumps at approval and execution.",
        check: (event) => checker.check(event),
      }));
    } catch (error) {
      checker?.dispose();
      throw error;
    }
  }
  if (hasTools) {
    const toolEntries = [
      { tool: NPM_CONFIG_TOOL, run: runNpmConfig },
      { tool: ENV_CONFIG_TOOL, run: runEnvConfig },
      { tool: PYPI_CONFIG_TOOL, run: runPypiConfig },
      { tool: CERTIFICATE_INFO_TOOL, run: runCertificateInfo },
    ];
    try {
      for (const { tool, run } of toolEntries) {
        unregisters.push(letta.tools.register({
          ...tool,
          run: (ctx) => {
            if (disposed || letta.signal?.aborted) return { status: "error", error: "Operation aborted." };
            const signal = AbortSignal.any([guardLifetime.signal, letta.signal, ctx?.signal].filter(Boolean));
            return run({ ...ctx, signal });
          },
        }));
      }
    } catch (error) {
      disposed = true;
      guardLifetime.abort();
      checker?.dispose();
      for (const unregister of unregisters) unregister();
      throw error;
    }
  }
  return () => {
    if (disposed) return;
    disposed = true;
    guardLifetime.abort();
    checker?.dispose();
    if (!letta.signal?.aborted) {
      for (const unregister of unregisters) unregister();
    }
  };
}

export const __testing = {
  POLICY,
  createChecker,
  CHECKER_TIMEOUT_MS,
  NPM_CONFIG_TOOL,
  runNpmConfig,
  ENV_CONFIG_TOOL,
  runEnvConfig,
  PYPI_CONFIG_TOOL,
  runPypiConfig,
  CERTIFICATE_INFO_TOOL,
  runCertificateInfo,
};
