# @css-archaeology/core

The browser-safe CSS Archaeology engine: stylesheet model, selector specificity, project model, configuration schema, confidence scoring and JSON/HTML reports. Node-only file discovery, configuration loading and caching are in `@css-archaeology/core/node`.

Part of [CSS Archaeology](https://github.com/abhisarena-sketch/CSS-Archealogy) by Workfonic Labs. Most people want the
CLI, [`css-archaeology`](https://www.npmjs.com/package/css-archaeology). Use this package to embed the analysis in your
own tools; see [Architecture](https://github.com/abhisarena-sketch/CSS-Archealogy/blob/main/docs/architecture.md#extending).

```ts
import { analyzeProject } from '@css-archaeology/core';
import { defaultAnalyzers } from '@css-archaeology/analyzers';
import { defaultAdapters } from '@css-archaeology/framework-adapters';

const result = await analyzeProject({ files, analyzers: defaultAnalyzers, adapters: defaultAdapters, config: {} });
```

MIT © Workfonic Labs
