# Поточна безпека і наступні перевірки

Актуальна архітектура: Cloudflare Durable Objects — основний стан акаунтів; KV — індекси, mappings і сумісний mirror. Firebase перевіряє Google ID tokens. Паролі — salted PBKDF2-SHA256; вхід видає окремі opaque Worker-сесії. Legacy SHA-256 зберігається лише для сумісного переходу після перевірки пароля.

У 5.13.0 закриті знайдені аудиторські прогалини: guest whitelist/expiry/revoke, неявна реєстрація, змішування AI-власників, export/import, приватне видалення, відновлюваний encrypted backup і rate-limit cleanup. Деталі й обмеження: [реліз 5.13.0](release-5.13.0.md), [операції recovery](recovery-operations.md).

Перед випуском: повний `npm run check`, `npm run worker:check`, актуальний dependency audit, реальна приватна копія й rehearsal, фізичні iPhone/Android та фактична доставка нагадувань. Зовнішній моніторинг/alerts, автоматичне приватне резервування й навантажувальний тест ще потребують налаштованої інфраструктури. Проходження тестів не доводить відсутності інших багів.

CORS лишається allowlist; secrets тільки в Worker, не в frontend/Git. Логи без credentials і приватних snapshot. Поточні namespace IDs не замінюються. Автоматичної міграції в Supabase немає: старий документ Supabase — історичний варіант, не чинна release-інструкція.
