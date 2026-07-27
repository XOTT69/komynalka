# Перехід на mykomunalka.pp.ua

> Статус: призупинено 24.07.2026. Поточний production-домен — `https://komynalka.vercel.app`. Не застосовуйте наведені нижче кроки до повторного запуску міграції.

## 1. Додати домен у Vercel

1. Відкрити Vercel → проєкт `komunalka` → **Settings** → **Domains**.
2. Додати `mykomunalka.pp.ua`.
3. Додати `www.mykomunalka.pp.ua`, якщо потрібна підтримка `www`.
4. Для `www.mykomunalka.pp.ua` вибрати **Redirect to** → `mykomunalka.pp.ua`.

## 2. Налаштувати DNS

Спочатку слід додати домен у Vercel і скопіювати саме ті DNS-значення, які покаже картка домену.

На момент перевірки 24.07.2026 домен ще припаркований: NS — `parked1.uadns.com` / `parked2.uadns.com`, A — `135.181.41.169`. Цей A-запис треба видалити або замінити у DNS-панелі реєстратора на значення, яке видасть Vercel.

Типова схема для зовнішнього DNS-провайдера:

| Тип | Ім'я | Значення |
| --- | --- | --- |
| A | `@` | Значення, яке показує Vercel; загальне значення — `76.76.21.21` |
| CNAME | `www` | Унікальний CNAME, який показує Vercel |

Якщо DNS керується через Cloudflare, на час першої верифікації варто вимкнути proxy для цих записів (**DNS only**). Потім дочекатися статусу **Valid Configuration** та SSL-сертифіка.

## 3. Дозволити Firebase Authentication

У Firebase Console відкрити проєкт `pwakomun` → **Authentication** → **Settings** → **Authorized domains** і додати:

- `mykomunalka.pp.ua`
- `www.mykomunalka.pp.ua`, якщо цей хост відкриватиме застосунок до редиректу.

Без цього Google/Firebase-вхід з нового домену може бути заблокований.

## 4. Редирект зі старого домену

`vercel.json` містить постійний host-redirect:

- `https://komynalka.vercel.app/<path>` → `https://mykomunalka.pp.ua/<path>`
- `https://www.mykomunalka.pp.ua/<path>` → `https://mykomunalka.pp.ua/<path>`

Шлях і query-параметри зберігаються. Vercel використовує `308` для `permanent: true`.

## 5. Перевірити після production-deploy

```bash
curl -I https://mykomunalka.pp.ua/
curl -I "https://komynalka.vercel.app/index.html?source=old"
```

Очікувано:

- новий домен повертає `200`;
- старий повертає `308` з `Location: https://mykomunalka.pp.ua/index.html?source=old`;
- Firebase-вхід, реєстрація, збереження та відновлення даних працюють на новому origin.

## Важливо для встановленої PWA

PWA, service worker, Firebase-сесія та `localStorage` прив'язані до origin. Після зміни домену користувачеві може знадобитися:

1. увійти в акаунт на новому домені;
2. встановити PWA з `mykomunalka.pp.ua`;
3. після перевірки даних видалити стару PWA.

Хмарні дані не видаляються і не переносяться разом із DNS — вони залишаються у поточному Worker/KV. Локальні несинхронізовані чернетки між origin автоматично не переносяться.
