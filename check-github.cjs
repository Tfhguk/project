
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { exit } = require('node:process');

const ROOT = __dirname;

const GH = path.join(
  ROOT,
  '.lan-tls',
  'github-cli-tool',
  'bin',
  'bin',
  'gh.exe'
);

const UPDATE_SCRIPT = path.join(
  ROOT,
  '.lan-tls',
  'update-github.cjs'
);

const REPO = 'Tfhguk/roi-site';

// Настройки ожидания
const CONFIG = {
  processTimeout: 15 * 60 * 1000,
  apiTimeout: 30 * 1000,
  maxAttempts: 24,
  retryInterval: 5000
};

// --------------------------------------------------
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// --------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function printError(message) {
  console.error('\n================================');
  console.error('       PUBLICATION FAILED');
  console.error('================================');
  
exit(1)
}

// Асинхронный запуск с выводом в CMD
// Одновременно сохраняет stdout и stderr.

function execute(command, args, label, options = {}) {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> ${label}\n`);

    let stdout = '';
    let stderr = '';
    let finished = false;
    let timedOut = false;

    const timeout = options.timeout ?? CONFIG.processTimeout;

    let child;

    try {
      child = spawn(command, args, {
        cwd: ROOT,
        windowsHide: false,
        stdio: ['inherit', 'pipe', 'pipe']
      });
    } catch (error) {
      reject(new Error(`${label}: ${error.message}`));
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;

      console.error(
        `\nТаймаут: ${label}. Процесс принудительно остановлен.`
      );

      child.kill();
    }, timeout);

    function finish(error, result) {
      if (finished) return;

      finished = true;
      clearTimeout(timer);

      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    }

    child.stdout.on('data', chunk => {
      const data = chunk.toString();

      stdout += data;
      process.stdout.write(data);
    });

    child.stderr.on('data', chunk => {
      const data = chunk.toString();

      stderr += data;
      process.stderr.write(data);
    });

    child.on('error', error => {
      finish(
        new Error(`${label}: ${error.message}`)
      );
    });

    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(
          new Error(
            `${label}: превышено время ожидания ${timeout / 1000} секунд`
          )
        );
        return;
      }

      if (code !== 0) {
        finish(
          new Error(
            `${label}: процесс завершился с кодом ${code}` +
            (signal ? `, сигнал ${signal}` : '') +
            (stderr ? `\n${stderr.trim()}` : '')
          )
        );
        return;
      }

      finish(null, {
        code,
        stdout,
        stderr
      });
    });
  });
}

// Получение результата команды.
// Вывод одновременно отображается в CMD.

async function capture(command, args, label, timeout = CONFIG.apiTimeout) {
  const result = await execute(
    command,
    args,
    label,
    { timeout }
  );

  return result.stdout.trim();
}

// --------------------------------------------------
// ПОЛУЧЕНИЕ COMMIT
// --------------------------------------------------

async function getLatestCommit() {
  const sha = await capture(
    GH,
    [
      'api',
      `repos/${REPO}/commits?per_page=1`,
      '--jq',
      '.[0].sha'
    ],
    'Получение текущего commit из GitHub'
  );

  if (!/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error(
      'GitHub вернул некорректный SHA commit: ' + sha
    );
  }

  return sha;
}

// --------------------------------------------------
// ПОИСК GITHUB ACTIONS С ОЖИДАНИЕМ
// --------------------------------------------------

async function findWorkflow(sha) {
  console.log('\nОжидание запуска GitHub Actions...');

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= CONFIG.maxAttempts;
    attempt++
  ) {
    console.log(
      `\nПроверка ${attempt}/${CONFIG.maxAttempts}...`
    );

    try {
      console.log('Запрашиваем GitHub API...');

      const output = await capture(
        GH,
        [
          'run', 'list',
          '--repo', REPO,
          '--commit', sha,
          '--limit', '10',
          '--json',
          'databaseId,status,conclusion,headSha'
        ],
        'Поиск GitHub Actions'
      );

      console.log('Ответ GitHub получен.');

      let runs;

      try {
        runs = JSON.parse(output);
      } catch {
        throw new Error(
          'Не удалось разобрать ответ GitHub Actions: ' + output
        );
      }

      const workflow = runs.find(
        item => item.headSha === sha
      );

      if (workflow) {
        console.log('\nGitHub Actions найден!');
        console.log('Workflow ID:', workflow.databaseId);
        console.log('Status:', workflow.status);
        console.log('Conclusion:', workflow.conclusion);

        return workflow;
      }

      console.log('Workflow пока не появился.');

      lastError = null;

    } catch (error) {
      lastError = error;

      console.error(
        '\nОшибка запроса: ' + error.message
      );
    }

    if (attempt < CONFIG.maxAttempts) {
      console.log(
        `Повторная проверка через ${CONFIG.retryInterval / 1000} секунд...`
      );

      await sleep(CONFIG.retryInterval);
    }
  }

  if (lastError) {
    throw new Error(
      'Не удалось получить данные GitHub Actions за 120 секунд.\n' +
      lastError.message
    );
  }

  throw new Error(
    'GitHub Actions не появился за 120 секунд.\n' +
    'Проверь .github/workflows, push и триггеры workflow.'
  );
}
function executeInteractive(command, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`\n>>> ${label}\n`);

    const child = spawn(command, args, {
      cwd: ROOT,
      windowsHide: false,
      stdio: 'inherit',
      env: {
        ...process.env,
        FORCE_COLOR: '3',
        CLICOLOR_FORCE: '1'
      }
    });

    const timer = setTimeout(() => {
      child.kill();
    }, CONFIG.processTimeout);

    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);

      if (code !== 0) {
        reject(
          new Error(
            `${label}: код ${code}, сигнал ${signal || 'нет'}`
          )
        );
        return;
      }

      resolve();
    });
  });
}
// --------------------------------------------------
// ОСНОВНАЯ ПРОГРАММА
// --------------------------------------------------

async function main() {
  console.log('\n================================');
  console.log('       ROI SITE PUBLISHER');
  console.log('================================');

  // 1. Проверяем GitHub CLI

  if (!fs.existsSync(GH)) {
    throw new Error(
      `GitHub CLI не найден:\n${GH}`
    );
  }

  // 2. Проверяем файл обновления

  if (!fs.existsSync(UPDATE_SCRIPT)) {
    throw new Error(
      `Скрипт обновления не найден:\n${UPDATE_SCRIPT}`
    );
  }

  // 3. Проверяем авторизацию GitHub
try {
  await execute(
    GH,
    ['auth', 'status'],
    'Проверка авторизации GitHub'
  );
 } catch (error) {
    exit(1);
  };

  // 4. Запускаем обновление и публикацию

  const publishResult = await execute(
    process.execPath,
    [UPDATE_SCRIPT],
    'Обновление и публикация проекта'
  );

  // 5. Проверяем, были ли изменения

  const publishOutput =
    publishResult.stdout + '\n' + publishResult.stderr;

  if (/No changes to publish/i.test(publishOutput)) {
    console.log('\n================================');
    console.log('       NO CHANGES');
    console.log('================================');
    console.log('\nИзменений нет.');
    console.log('Публикация не требуется.');
    return;
  }

  // 6. Получаем SHA непосредственно с GitHub

  const sha = await getLatestCommit();

  console.log('\nCommit:', sha);

  // 7. Ожидаем появления GitHub Actions

  const workflow = await findWorkflow(sha);

  // 8. Ожидаем завершения GitHub Actions


  try {
  await executeInteractive(
    GH,
    [
      'run', 'watch',
      String(workflow.databaseId),
      '--repo', REPO,
      '--exit-status',
      '--interval', '5'
    ],
    'Ожидание GitHub Actions'
  );

} catch (error) {

  console.error('\nGitHub Actions завершился с ошибкой.');

  try {
    const logs = await execute(
      GH,
      [
        'run', 'view',
        String(workflow.databaseId),
        '--repo', REPO,
        '--log-failed'
      ],
      'Получение логов неудачных этапов'
    );

  } catch (logError) {
    console.error(
      'Не удалось получить дополнительные логи: ' +
      logError.message
    );
  }

  throw error;
}
  

  // 10. Успешное завершение

  console.log('\n================================');
  console.log('       PUBLICATION SUCCESS');
  console.log('================================\n');
}

// --------------------------------------------------
// ОБРАБОТКА ЗАВЕРШЕНИЯ ПРОГРАММЫ
// --------------------------------------------------

main()
  .then(() => {
    console.log('\nРабота программы завершена.');
  })
  .catch(error => {
    printError(error.message);
    process.exitCode = 1;
  });
