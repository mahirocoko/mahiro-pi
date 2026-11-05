---
name: creating-skills
description: Guide for creating effective skills. Use when creating a new skill or updating an existing one that extends the agent's capabilities with specialized knowledge, workflows, or tool integrations, whether a user asks for it or a reusable workflow is worth capturing.
---

# Creating Skills

This skill provides guidance for creating effective skills following the [Agent Skills specification](https://agentskills.io/specification).

## About Skills

Skills are modular, self-contained packages that extend the agent's capabilities by providing specialized knowledge, workflows, and tools. Think of them as "onboarding guides" for specific domains or tasks—they transform a general-purpose coding agent into a specialized agent equipped with procedural knowledge that no model can fully possess out of the box.

### What Skills Provide

1. Specialized workflows - Multi-step procedures for specific domains
2. Tool integrations - Instructions for working with specific file formats, CLIs, or APIs
3. Domain expertise - Project-specific knowledge, schemas, business logic
4. Bundled resources - Scripts, references, and assets for complex and repetitive tasks

## Where Skills Live

Pi discovers skills from three filesystem locations (not inside the private `~/.pi/agent/memory` store):

1. **Global User Skills (`~/.pi/agent/skills/<skill-name>/SKILL.md`)**:
   - Loaded across every project and workspace on the machine.
   - Default destination when creating a general-purpose or personal workflow skill (or author inside the canonical `mahiro-skills` repository when maintaining versioned personal skills synced to `~/.pi/agent/skills/`).
2. **Project-Local Skills (`<project-root>/.pi/skills/<skill-name>/SKILL.md`)**:
   - Loaded only when working inside that repository.
   - Use for repository-specific workflows that should not appear in other projects' `<available_skills>` catalog.
3. **Package Built-in Skills (`skills/<skill-name>/SKILL.md`)**:
   - Shipped inside a Pi package manifest (`"pi": { "skills": ["./skills"] }`), such as `mahiro-pi`'s built-in memory and commit skills.

*(Note: Short memory-only checklists that do not need a standalone skill directory or bundled scripts belong in maintained memory under `procedures/<name>.md` via `agent_memory_edit`.)*

## Core Principles

### Concise is Key

The context window is a public good. Skills share the context window with everything else the agent needs: system prompt, `<mahiro-managed-memory>`, conversation history, other skills' metadata, and the actual user request.

**Default assumption: the agent is already very capable.** Only add context the agent does not already have. Challenge each piece of information: "Does the agent really need this explanation?" and "Does this paragraph justify its token cost?"

Prefer concise examples over verbose explanations.

### Set Appropriate Degrees of Freedom

Match the level of specificity to the task's fragility and variability:

**High freedom (text-based instructions)**: Use when multiple approaches are valid, decisions depend on context, or heuristics guide the approach.

**Medium freedom (pseudocode or scripts with parameters)**: Use when a preferred pattern exists, some variation is acceptable, or configuration affects behavior.

**Low freedom (specific scripts, few parameters)**: Use when operations are fragile and error-prone, consistency is critical, or a specific sequence must be followed.

Think of the agent as exploring a path: a narrow bridge with cliffs needs specific guardrails (low freedom), while an open field allows many routes (high freedom).

### Anatomy of a Skill

Every skill consists of a required `SKILL.md` file and optional bundled resources:

```text
processing-pdfs/
├── SKILL.md (required)
│   ├── YAML frontmatter metadata (required)
│   │   ├── name: (required, must match directory name)
│   │   └── description: (required)
│   └── Markdown instructions (required)
└── Bundled Resources (optional)
    ├── scripts/          - Executable code (Node.js .mjs / Python / Bash / etc.)
    ├── references/       - Documentation intended to be loaded into context as needed
    └── assets/           - Files used in output (templates, icons, fonts, etc.)
```

#### SKILL.md (required)

Every `SKILL.md` consists of:

- **Frontmatter** (YAML): Contains `name` and `description` fields. These are the fields the agent reads in `<available_skills>` to determine when the skill gets used, so be clear and comprehensive in describing what the skill is and when it should be loaded.
- **Body** (Markdown): Instructions and guidance for using the skill. Only loaded AFTER the skill triggers.

#### Bundled Resources (optional)

##### Scripts (`scripts/`)

Executable code (`node`, `python3`, `bash`, etc.) for tasks that require deterministic reliability or are repeatedly rewritten.

- **When to include**: When the same code is being rewritten repeatedly or deterministic reliability is needed
- **Example**: `scripts/rotate-pdf.mjs` for PDF rotation tasks
- **Benefits**: Token efficient, deterministic, may be executed without loading into context
- **Note**: Scripts may still need to be read by the agent for patching or environment-specific adjustments

##### References (`references/`)

Documentation and reference material intended to be loaded as needed into context to inform the agent's process and thinking.

- **When to include**: For documentation that the agent should reference while working
- **Examples**: `references/finance.md` for financial schemas, `references/policies.md` for policies, `references/api_docs.md` for API specifications
- **Use cases**: Database schemas, API documentation, domain knowledge, detailed workflow guides
- **Benefits**: Keeps `SKILL.md` lean; loaded only when the agent determines it is needed
- **Best practice**: If files are large (>10k words), include grep search patterns in `SKILL.md`
- **Avoid duplication**: Information should live in either `SKILL.md` or `references/` files, not both. Keep only essential procedural instructions and workflow guidance in `SKILL.md`; move detailed reference material, schemas, and examples to `references/` files.

##### Assets (`assets/`)

Files not intended to be loaded into context, but rather used within the output the agent produces.

- **When to include**: When the skill needs files that will be used in the final output
- **Examples**: `assets/logo.png` for brand assets, `assets/slides.pptx` for templates, `assets/frontend-template/` for boilerplate
- **Use cases**: Templates, images, icons, boilerplate code, fonts, sample documents that get copied or modified
- **Benefits**: Separates output resources from documentation, enabling the agent to use files without loading them into context

#### What to Not Include in a Skill

A skill should only contain essential files that directly support its functionality. Do NOT create extraneous documentation or auxiliary files, including:

- `README.md`
- `INSTALLATION_GUIDE.md`
- `QUICK_REFERENCE.md`
- `CHANGELOG.md`

The skill should only contain the information needed for an agent (and human reader) to do the job at hand.

### Progressive Disclosure Design Principle

Skills use a three-level loading system to manage context efficiently:

1. **Metadata (`name` + `description`)** - Always in context (~100 words)
2. **`SKILL.md` body** - When skill triggers (<5k words, under 500 lines)
3. **Bundled resources** - Loaded or executed as needed by the agent

#### Progressive Disclosure Patterns

Keep `SKILL.md` body to the essentials and under 500 lines to minimize context bloat. Split content into separate files when approaching this limit. When splitting out content into other files, reference them from `SKILL.md` and describe clearly when to read them.

**Key principle:** When a skill supports multiple variations, frameworks, or options, keep only the core workflow and selection guidance in `SKILL.md`. Move variant-specific details (patterns, examples, configuration) into separate reference files.

**Pattern 1: High-level guide with references**

```markdown
# PDF Processing

## Quick start

Extract text with pdfplumber:
[code example]

## Advanced features

- **Form filling**: See [FORMS.md](FORMS.md) for complete guide
- **API reference**: See [REFERENCE.md](REFERENCE.md) for all methods
- **Examples**: See [EXAMPLES.md](EXAMPLES.md) for common patterns
```

**Pattern 2: Domain-specific organization**

```text
querying-bigquery/
├── SKILL.md (overview and navigation)
└── references/
    ├── finance.md (revenue, billing metrics)
    ├── sales.md (opportunities, pipeline)
    ├── product.md (API usage, features)
    └── marketing.md (campaigns, attribution)
```

**Pattern 3: Conditional details**

```markdown
# DOCX Processing

## Creating documents

Use docx-js for new documents. See [DOCX-JS.md](DOCX-JS.md).

## Editing documents

For simple edits, modify the XML directly.

**For tracked changes**: See [REDLINING.md](REDLINING.md)
**For OOXML details**: See [OOXML.md](OOXML.md)
```

**Important guidelines:**

- **Avoid deeply nested references** - Keep references one level deep from `SKILL.md`. All reference files should link directly from `SKILL.md`.
- **Structure longer reference files** - For files longer than 100 lines, include a table of contents at the top so the agent can see the full scope when previewing.

## Skill Creation Process

Skill creation involves these steps:

1. Understand the skill with concrete examples
2. Plan reusable skill contents (`scripts/`, `references/`, `assets/`)
3. Initialize the skill (`init-skill.mjs`)
4. Edit the skill (implement resources and write `SKILL.md`)
5. Validate (and optionally package) the skill (`validate-skill.mjs` / `package-skill.mjs`)
6. Iterate based on real usage

Follow these steps in order, skipping only if there is a clear reason why they are not applicable.

### Step 1: Understanding the Skill with Concrete Examples

To create an effective skill, clearly understand concrete examples of how the skill will be used. Draw them from the material at hand first: the conversation or transcripts that motivated the skill, the commands and tool calls that worked, and the requests that would trigger it.

For example, when building an `editing-images` skill, establish:

- What functionality the skill should support: editing, rotating, anything else?
- What concrete requests it should handle, such as "Remove the red-eye from this image" or "Rotate this image"
- What a user would say that should trigger the skill

If you are working with a user and these remain unclear, ask the most important questions first rather than many at once.

### Step 2: Planning the Reusable Skill Contents

To turn concrete examples into an effective skill, analyze each example by:

1. Considering how to execute on the example from scratch
2. Identifying what scripts, references, and assets would be helpful when executing these workflows repeatedly

### Step 3: Initializing the Skill

Skip this step only if the skill being developed already exists.

Choose the target output directory based on scope:
- `~/.pi/agent/skills` for a user-global Pi skill
- `.pi/skills` for a project-local skill in the current repository

Run the `init-skill.mjs` script to scaffold a new skill directory:

```bash
node <SKILL_DIR>/scripts/init-skill.mjs <skill-name> --path <output-directory>
```

Where `<SKILL_DIR>` is the directory containing this `SKILL.md`. If you do not need placeholder resource folders, you can also create `<output-directory>/<skill-name>/SKILL.md` directly.

### Step 4: Edit the Skill

When editing the skill, include information that is beneficial and non-obvious to another agent instance (and readable for a human collaborator).

#### Learn Proven Design Patterns

Consult these helpful guides based on your skill's needs:

- **Multi-step processes**: See [references/workflows.md](references/workflows.md) for sequential workflows and conditional logic
- **Specific output formats or quality standards**: See [references/output-patterns.md](references/output-patterns.md) for template and example patterns

#### Start with Reusable Skill Contents

Start with the reusable resources identified in Step 2 (`scripts/`, `references/`, and `assets/`). Test any added scripts by running them on a representative input. Delete any placeholder files or empty directories that the skill does not need.

#### Update SKILL.md

**Writing Guidelines:** Always use imperative/infinitive form.

##### Frontmatter

Write the YAML frontmatter with `name` and `description`:

**`name`** (required):
- Use hyphen-case (preferably gerund form): `processing-pdfs`, `analyzing-data`, `creating-reports`
- Lowercase letters, numbers, and hyphens only
- Must match the directory name exactly
- Max 64 characters

**`description`** (required):
- Write in third person: "Extracts text and tables from PDF files..." (not "I help process..." or "You can use this to...")
- Include both what the skill does AND when to use it
- Include trigger keywords that help the agent identify relevant tasks
- Max 1024 characters, no `<` or `>` angle brackets

Example:
```yaml
---
name: processing-pdfs
description: Extracts text and tables from PDF files, fills forms, and merges documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.
---
```

##### Body

Write clear instructions for using the skill and its bundled resources.

### Step 5: Validating and Packaging a Skill

Always validate the skill directory after editing:

```bash
node <SKILL_DIR>/scripts/validate-skill.mjs <path/to/skill-folder>
```

Skills maintained in place under `~/.pi/agent/skills/`, `.pi/skills/`, or a package's `skills/` directory are used directly by Pi and need no zip packaging. When a distributable `.skill` archive is explicitly requested for sharing, run:

```bash
node <SKILL_DIR>/scripts/package-skill.mjs <path/to/skill-folder> [output-directory]
```

### Step 6: Iterate

Improve a skill when real usage shows it falling short:

1. Use the skill on real tasks
2. Notice struggles, missing edge cases, or unnecessary token bloat
3. Update `SKILL.md` or bundled resources and re-run `validate-skill.mjs`
