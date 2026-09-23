# Stack fundamentals

Read the section for the stack in front of you. Each one names the first-party source and version
it was read from (2026-09-23), the rules that decide correctness, the check native to the stack,
and the traps its own docs warn about. It is a starting map, not API truth: the installed version's
documentation still wins (`grounding`), and a version newer than the one named here means reading
again. The list is open: a stack that is not here gets the same treatment from its own docs.

## React
Source: react.dev/learn, React 19.3; React Compiler 1.0 stable.
- Rendering is pure: same props and state, same output, nothing outside mutated. Strict Mode
  renders twice in development to expose this.
- Keep state minimal; compute what can be derived while rendering. Do not copy props into state.
  One `status` value beats several booleans that can contradict each other.
- State is a snapshot and read-only: copy nested objects and arrays; use updater functions for
  queued updates. Never define a component inside another; reset a subtree with `key`.
- Effects only synchronise with something outside React; work caused by a user action belongs in
  its event handler. The dependency list follows the code. Effects that subscribe clean up; guard
  fetch races (`ignore` flag or `AbortController`). `useEffectEvent` is stable.
- Check: `eslint-plugin-react-hooks` (`recommended` preset), `tsc`, React DevTools Profiler.
- Traps: index or random keys; `count && <X/>` renders `0`; `onClick={f()}`; silencing the
  dependency lint; code that relies on memoisation to be correct breaks under the compiler.

## Angular
Source: angular.dev, v22.1.
- Standalone components: whatever a template uses is in the component's `imports`.
- `@if` / `@for` control flow; `track` is required in `@for`.
- State in signals (`signal`, `computed`, `set` / `update`); read a signal by calling it.
- `inject()` for dependencies; forms are template-driven, reactive, or signal forms.
- Zoneless is the default (v21+): in tests prefer `await fixture.whenStable()`; `fakeAsync` is not
  recommended and does not work with Vitest.
- Check: Vitest is the default runner for new CLI projects (Karma still supported); component
  harnesses test the way a user interacts.
- Security: never build templates from user input; any `bypassSecurityTrust*` call needs a
  security review; use `autoCsp` and Trusted Types; AOT only.

## Ionic
Source: ionicframework.com/docs, v9.
- Listen for `ion*` events; a plain `click` inside a shadow root is retargeted and can fire twice.
- Ionic Config is not reactive; virtual properties such as `mode` apply once.
- Wait for `platform.ready()` and check the platform before a native call; give browsers a fallback.
- Web views enforce CORS; device file paths go through `Capacitor.convertFileSrc`.
- The hardware back button runs one handler by priority; check `canGoBack()` before exiting.
- Traps: `autofocus` (use `setFocus` after the view enters), `innerHTML` templates stay disabled.

## React Native
Source: reactnative.dev, 0.87.1; Expo is the recommended way to start.
- Long lists use `FlatList` / `SectionList` (or FlashList), with `keyExtractor`, a memoised
  `renderItem` and `getItemLayout` when rows have a fixed height. `ScrollView` renders every child.
- The JS thread and the UI thread are separate; a frame has 16.67 ms. Use `useNativeDriver`, and
  animate an image's size with `transform: scale`.
- Platform differences: `Platform.OS`, `Platform.select`, or `.ios.` / `.android.` files.
- `SafeAreaView` is deprecated: use `react-native-safe-area-context`. Prefer `Pressable`.
- Check: Jest with React Native Testing Library (query by text and accessibility, not testID);
  Detox, Appium or Maestro end to end. Profile release builds only (Perfetto, Instruments).
- Security: no secrets in the bundle; AsyncStorage is unencrypted, so tokens go to Keychain /
  Keystore (`expo-secure-store`); OAuth with PKCE; no tokens in deep links.

## Node.js
Source: nodejs.org/learn and the API docs; v26.10, LTS v24.21. Where Learn is older than the API
docs, the API docs win.
- Never block the event loop: no `*Sync` APIs in a server, no ReDoS-prone regexes (nested
  quantifiers, overlapping alternation), bounded input to `JSON.parse`. CPU work goes to
  `worker_threads`.
- `setImmediate` over recursive `process.nextTick` (which starves I/O). In ESM, promise callbacks
  run before `nextTick` callbacks. `Promise.all` does not cancel the others when one rejects.
- Streams: `pipeline()` (not `.pipe()`, which leaks on error); after `.write()` returns false,
  wait for `'drain'`. An `'error'` event with no listener crashes the process.
- TypeScript: type stripping does not type-check (run `tsc --noEmit`), ignores `tsconfig.json`,
  does not support `.tsx`, and treats decorators as a parse error.
- Check: `node --test` (snapshots stable; coverage still experimental), `npm ci` with the lockfile.
- Security: `timingSafeEqual` for secrets; set `headersTimeout` / `requestTimeout`; never expose
  the inspector; guard prototype pollution (`Object.hasOwn`, `Object.create(null)`).

## NestJS
Source: docs.nestjs.com, v12.
- Request order: middleware, guards, interceptors (before), pipes, handler, interceptors (after),
  exception filters.
- A global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted` and `transform`; DTOs are
  classes, because interfaces and generics are not validated. v12 adds Standard Schema pipes.
- Register global guards as `APP_GUARD` providers (they get dependency injection);
  `useGlobalGuards()` cannot inject. Auth guard global, with an explicit public opt-out.
- Request scope spreads up the dependency chain and costs performance; singleton is the default.
- Call `enableShutdownHooks()` yourself. v12 reorders lifecycle hooks by module level.
- Check: new ESM projects use Vitest, CommonJS projects Jest; `Test.createTestingModule`.
  Needs Node 20.19+ or 22.12+.

## Python
Source: docs.python.org 3.14, PEP 8, packaging.python.org, pytest 9.
- Default argument values are evaluated once: never a mutable default. Use `with` for files.
- Annotations are not enforced at runtime: run a type checker.
- Compare to `None` with `is`; catch `Exception`, never a bare `except:`.
- Packaging: `pyproject.toml`, venv; pip-tools or Pipenv lock files; direct `setup.py` calls are
  deprecated. PyPA does not name uv, so do not claim it recommends it.
- Check: pytest, src layout with `--import-mode=importlib` for new projects, `pytest.approx` for floats.
- Security: never unpickle untrusted data; `shell=True` makes injection your job; `yaml.safe_load`.

## Terraform
Source: developer.hashicorp.com tutorials, Terraform 1.12.
- Write, `init`, `plan`, `apply`; in pipelines apply a saved plan (`plan -out`).
- `apply` is not transactional: a partial apply does not roll back.
- Commit `.terraform.lock.hcl`; pin provider and module versions.
- State holds secrets in plain text (`sensitive` only hides output): remote, encrypted, locked
  state; git-ignore `*.tfstate` and `*.tfvars`. Never edit state by hand.
- `moved` / `import` blocks over manual surgery; `-target` only for troubleshooting;
  `prevent_destroy` on what must survive.
- Check: `fmt`, `validate`, `plan`, `terraform test`. `apply` and `destroy` are infrastructure
  actions: T2 or higher, and they need an approval that names them.

## AWS
Source: IAM best practices, Well-Architected Framework and its Generative AI Lens (2025-11-19).
- People use federation with temporary credentials; workloads use roles; no long-lived keys where
  avoidable; MFA; the root user locked away.
- Least privilege, generated and checked with IAM Access Analyzer; SCPs and permission boundaries
  as guardrails.
- Encrypt in transit and at rest; trace everything; small, reversible, automated changes.
- For AI workloads: least privilege on model endpoints and for agents, guardrails, a managed prompt
  catalog, tracing, and timeouts on agent workflows.
- Tutorials and courses that open `0.0.0.0/0` or use access keys are teaching shortcuts, not practice.

## Swift and Apple platforms
Source: developer.apple.com (Swift 6, Xcode 26.6), Foundation Models docs.
- Swift 6 language mode checks data races at compile time; SwiftUI state uses `@Observable`.
- Swift Testing and XCTest can live in one target. `xcodebuild test -scheme <s> -only-testing
  <Target/Suite/test>`; results land in an `.xcresult` bundle.
- Xcode's MCP bridge (`xcrun mcpbridge`) gives a terminal agent Xcode's build, test and doc search
  while Xcode has the project open; installing it is an ask-once step (`tooling`).
- Foundation Models: an on-device model with a 4,096-token context. Suited to summarising,
  extracting and classifying; Apple says to avoid code, maths and logical reasoning. Check
  `SystemLanguageModel.default.availability` and show another UI when it is unavailable; evaluate
  on eligible devices (`ai-eval`) before falling back to a server model.

## Full stack
Roadmaps (roadmap.sh 2026-01, older lists) cover the topics: HTML, CSS, JavaScript, a UI library,
Node, SQL, REST and auth, caching, Linux, cloud, CI/CD, infrastructure as code, monitoring. They
teach getting something deployed, not correctness. Add what they leave out: tests at every layer,
accessibility, secrets kept out of code and state, server-side authorisation on every route, and
one error contract the clients can rely on.
