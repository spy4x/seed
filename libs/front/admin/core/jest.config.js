module.exports = {
  name: 'admin-core',
  preset: '../../../../jest.config.js',
  coverageDirectory: '../../../coverage/libs/front/admin/core',
  snapshotSerializers: [
    'jest-preset-angular/build/AngularNoNgAttributesSnapshotSerializer.js',
    'jest-preset-angular/build/AngularSnapshotSerializer.js',
    'jest-preset-angular/build/HTMLCommentSerializer.js',
  ],
};
