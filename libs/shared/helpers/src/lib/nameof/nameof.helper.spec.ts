import { nameof } from './nameof.helper';

describe(nameof.name, () => {
  it('returns property name', () => {
    const obj = {
      myProp: 'value',
    };
    expect(nameof(obj, x => x.myProp)).toEqual('myProp');
  });

  it('returns property name of nested object', () => {
    const obj = {
      nested: {
        prop: 'value',
      },
    };
    expect(nameof(obj.nested, x => x.prop)).toEqual('prop');
  });

  it('returns property name of a function', () => {
    const obj = {
      myFunc: (): string => {
        return '';
      },
    };
    expect(nameof(obj, x => x.myFunc)).toEqual('myFunc');
  });

  it('returns property name of a class instance', () => {
    class MyClass {
      myProp = 'value';
    }
    const obj = new MyClass();
    expect(nameof(obj, x => x.myProp)).toEqual('myProp');
  });
});
