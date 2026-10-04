// This appendix belongs only to the finite fixture, never to browser evidence.
const fixtureNames = ['resource', 'loader', 'observer', 'identifier_a',
  'identifier_b', 'cancel', 'error'];
rpc.exports.fixtureHooks = function () {
  const module = Process.enumerateModules()[0];
  return fixtureNames.map((name) => ({
    event: name.startsWith('identifier') ? 'identifier' : name,
    offset: module.getSymbolByName(`fixture_${name}`).sub(module.base).toUInt32(),
    symbol: `fixture_${name}`,
  }));
};
rpc.exports.fixtureBoundary = function () {
  // Fault injection at the exact original capacity, not a smaller journal.
  journal.add(28).writeU32(499999);
  journal.add(32).writeU32(499999);
};
rpc.exports.fixtureAlternate = function (code, clockName, publication) {
  // Compile the byte-identical embedded recorder with a controlled C clock.
  // All seven callbacks still execute through real Gum on the native fixture.
  for (const hook of hooks) hook.detach();
  hooks.length = 0;
  Interceptor.flush();
  const state = Memory.alloc(64);
  const main = Process.enumerateModules()[0];
  if (publication) {
    new NativeFunction(main.getSymbolByName('fixture_publication_config'), 'void',
      ['pointer', 'pointer'])(journal, native.code);
  }
  const module = new CModule(code, {
    journal, state, release_store: publication ? main.getSymbolByName('fixture_release_store') : native.code,
    acquire_load: native.code.add(64), atomic_add: native.code.add(128),
    native_clock_gettime: clockName ? main.getSymbolByName(clockName) : Module.getGlobalExportByName('clock_gettime'),
  });
  const previous = native;
  native = { module, code: previous.code, state, previous };
  for (const hook of rpc.exports.fixtureHooks()) {
    const kind = ['resource', 'loader', 'observer', 'identifier', 'cancel', 'error'].indexOf(hook.event) + 1;
    hooks.push(Interceptor.attach(main.base.add(hook.offset),
      { onEnter: module.enter, onLeave: module.leave }, ptr(kind)));
  }
  Interceptor.flush();
  return true;
};
