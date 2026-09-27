const decoratorsPreset = () => ({
  plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
});

module.exports = {
  // Babel evaluates presets from right to left. Strip TypeScript definite-assignment
  // markers before the decorators transform initializes decorated class fields.
  presets: [
    decoratorsPreset,
    require('@babel/preset-typescript/package.json').version.startsWith('7.')
      ? ['@babel/preset-typescript', { allowDeclareFields: true }]
      : '@babel/preset-typescript',
  ],
};
