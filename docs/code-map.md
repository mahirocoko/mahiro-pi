# Code Map

[← Feature guide](README.md) · [Guards](guards.md)

`mh_code_map` returns bounded repository-navigation guidance from **caller-supplied
metadata**. Despite its name, it does not search files, build an index, infer a
symbol outline or verify source.

## Use

The model may request `semantic`, `exact` or `outline` intent with a short query.
For example:

```json
{"intent":"exact","query":"createWebActivityPublisher","path_hints":["lib/worker-activity-web.ts"]}
```

The result guides a subsequent real filename/exact search or bounded source read.
Navigation entries, language/path hints, optional large-read guidance and
Goal/Evidence references remain caller metadata. A returned path or reference is
not proof the file exists or permission to read it. There is no slash command.

## Authority and limits

Execution requires the exact named capability, healthy canonical source
provenance and winning-rule attestation from the public permission owner.
Family wildcards or an old service without attestation are insufficient.
The one-install composition's feature-data grants do not substitute for the
separate Code Map tool authority; inspect actual policy.

The closed schema bounds inputs and a 3,000-character guidance formatter.
Registration/formatting do not scan workspace source. Execution's canonical
authority check may read package/provenance and existing policy metadata.
It does not attach evidence to Goals, execute suggested searches or turn opaque
references into authorization.

Owner: `extensions/mahiro-code-map.ts` and `lib/code-map.ts`.
The [dated integration record](integrations.md#code-map--source-only-second-all-mods-slice)
retains migration and isolated SDK evidence, not current profile activation.
