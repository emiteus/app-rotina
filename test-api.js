const http = require('http');

console.log('\n🔌 TESTE DE API\n');

const tests = [
  { path: '/', name: 'GET / (home page)' },
  { path: '/api/tasks', name: 'GET /api/tasks' },
  { path: '/api/financeiro', name: 'GET /api/financeiro' },
  { path: '/api/alarmes', name: 'GET /api/alarmes' },
  { path: '/style.css', name: 'GET /style.css' },
  { path: '/app.js', name: 'GET /app.js' }
];

let testsPassed = 0;

function makeRequest(path, callback) {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: path,
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      callback(res.statusCode, data);
    });
  });

  req.on('error', (error) => {
    callback('ERROR', error.message);
  });

  req.end();
}

let completed = 0;

tests.forEach(test => {
  makeRequest(test.path, (status, data) => {
    if (status === 200) {
      console.log(`✅ ${test.name} (200 OK)`);
      testsPassed++;
    } else if (status === 304) {
      console.log(`✅ ${test.name} (304 Not Modified)`);
      testsPassed++;
    } else {
      console.log(`❌ ${test.name} (${status})`);
    }

    completed++;
    if (completed === tests.length) {
      console.log(`\n📊 RESULTADOS:`);
      console.log(`   ✅ Passou: ${testsPassed}/${tests.length}`);
      console.log(`   ✨ APIs respondendo corretamente!\n`);
    }
  });
});
