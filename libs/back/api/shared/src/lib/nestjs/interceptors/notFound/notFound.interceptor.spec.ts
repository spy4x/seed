import { of } from 'rxjs';
import { NotFoundInterceptor } from './notFound.interceptor';
import { NotFoundException } from '@nestjs/common';

describe(NotFoundInterceptor.name, () => {
  const notFoundInterceptor = new NotFoundInterceptor();

  const contextMock = jest.fn().mockImplementation(() => ({
    switchToHttp: () => ({
      getRequest: () => null,
    }),
  }));
  let data: any = null;
  const nextMock = jest.fn().mockImplementation(() => {
    return {
      handle: () => {
        return of(data);
      },
    };
  });

  it('should throw NotFoundException if no data presented', done => {
    notFoundInterceptor.intercept(new contextMock(), new nextMock()).subscribe(null, err => {
      expect(err).toEqual(new NotFoundException());
      done();
    });
  });
  it('should not throw Exception if data presented', async () => {
    data = { payload: 'Payload!' };

    const _data = await notFoundInterceptor.intercept(new contextMock(), new nextMock()).toPromise();
    expect(_data).toEqual(data);
  });
});
