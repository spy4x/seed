import { MicroRouterStateSerializer } from './router.serializer';

describe(MicroRouterStateSerializer.name, () => {
  const serializer = new MicroRouterStateSerializer();

  it('returns { url, params, queryParams }', () => {
    const state = { url: '/my-url', params: { p1: '1', p2: 2 }, queryParams: { p3: true, p4: false } };
    const snapshot = {
      url: state.url,
      root: {
        params: state.params,
        queryParams: state.queryParams,
      },
    };
    expect(serializer.serialize(snapshot as any)).toEqual(state);
  });
});
