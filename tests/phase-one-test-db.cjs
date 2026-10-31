const fallback = 'postgresql://postgres:salama-local-test@127.0.0.1:55439/salama_phase1_test';
const testUrl = process.env.SALAMA_PHASE1_TEST_URL || fallback;
const url = new URL(testUrl);
if (url.hostname !== '127.0.0.1' || url.port !== '55439' || !/^\/salama_phase1_test(?:_round_\d+)?$/.test(url.pathname)) throw Error('Refusing integration tests outside the dedicated disposable database');
module.exports = { testUrl };
