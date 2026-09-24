const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');
module.exports = defineConfig([expo, {
  ignores: ['dist/**', 'ios/**', 'android/**'],
  rules: { 'no-control-regex': 'off' },
}]);
