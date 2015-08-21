let moduleRoot = '../es6';
if (process.env.TEST_RELEASE) {
  moduleRoot = '../dist';
}

const googleCarddav = require(moduleRoot);

describe('googleCarddav', () => {
  it('works', async () => {
    const result = await googleCarddav();
    result.should.be.equal(42);
  });
});

