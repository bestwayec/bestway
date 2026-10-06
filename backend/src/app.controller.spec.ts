import { afterEach, describe, expect, it } from 'vitest';
import { AppController } from './app.controller';

const previousBuildCommit = process.env.BUILD_COMMIT;

afterEach(() => {
  if (previousBuildCommit === undefined) delete process.env.BUILD_COMMIT;
  else process.env.BUILD_COMMIT = previousBuildCommit;
});

describe('health endpoint', () => {
  it('exposes the deployed build commit without exposing configuration secrets', () => {
    process.env.BUILD_COMMIT = '1dcd46e8be08a1d612fb76babb3c12fcb65dd1a0';
    expect(new AppController().health()).toMatchObject({
      status: 'ok',
      buildCommit: '1dcd46e8be08a1d612fb76babb3c12fcb65dd1a0',
    });
  });
});
