module.exports = {
  name: 'client-core',
  preset: '../../../../jest.config.js',
  coverageDirectory: '../../../coverage/libs/front/client/core',
  snapshotSerializers: [
    'jest-preset-angular/build/AngularNoNgAttributesSnapshotSerializer.js',
    'jest-preset-angular/build/AngularSnapshotSerializer.js',
    'jest-preset-angular/build/HTMLCommentSerializer.js',
  ],
};
