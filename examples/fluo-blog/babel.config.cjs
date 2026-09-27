module.exports = {
  presets: [require('@babel/preset-typescript/package.json').version.startsWith('7.')
    ? ['@babel/preset-typescript', { allowDeclareFields: true }]
    : '@babel/preset-typescript'],
  plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
};
