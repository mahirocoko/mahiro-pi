// Deterministic executable transport, never a provider or live RTK configuration.
import fs from "node:fs";
import path from "node:path";
export function installRTKHelper(base) {
  const bin = path.join(base, "bin");
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(bin, "package.json"),
    JSON.stringify({ type: "commonjs" }),
  );
  const control = path.join(base, "helper.json");
  const marker = path.join(base, "helper-calls.jsonl");
  const native = path.join(base, "native-calls.jsonl");
  fs.writeFileSync(control, "{}", { mode: 0o600 });
  fs.writeFileSync(
    path.join(bin, "rtk"),
    `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== 'rewrite') {
  fs.appendFileSync(${JSON.stringify(native)}, JSON.stringify(args)+'\\n');
  console.log('FAKE_RTK_NATIVE');
} else {
  fs.appendFileSync(${JSON.stringify(marker)}, JSON.stringify({args,cwd:process.cwd()})+'\\n');
  const spec = JSON.parse(fs.readFileSync(${JSON.stringify(control)}, 'utf8'));
  setTimeout(() => {
    if (spec.invalidUtf8) process.stdout.write(Buffer.from([255]));
    else process.stdout.write(spec.bytes ? 'x'.repeat(spec.bytes) : (spec.out ?? 'rtk ls safe.txt\\n'));
    process.stderr.write(spec.err ?? '');
    process.exitCode = spec.code ?? 0;
  }, spec.delay ?? 0);
}
`,
    { mode: 0o700 },
  );
  return {
    bin,
    marker,
    native,
    set: (spec) => fs.writeFileSync(control, JSON.stringify(spec)),
    calls: () =>
      fs.existsSync(marker)
        ? fs.readFileSync(marker, "utf8").trim().split("\n").map(JSON.parse)
        : [],
    spawns: () =>
      fs.existsSync(native)
        ? fs.readFileSync(native, "utf8").trim().split("\n").map(JSON.parse)
        : [],
  };
}
