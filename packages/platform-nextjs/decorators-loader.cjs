'use strict';

module.exports = function fluoDecoratorsLoader(source, inputSourceMap) {
  const callback = this.async();

  import('./dist/decorators-transform.js')
    .then(({ transformFluoDecorators }) =>
      transformFluoDecorators(source, this.resourcePath, inputSourceMap),
    )
    .then(({ code, map }) => {
      callback(null, code, map);
    })
    .catch((error) => {
      callback(error instanceof Error ? error : new Error(String(error)));
    });
};
