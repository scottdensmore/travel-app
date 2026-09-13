const DISPOSABLE_MARKER = 'DATABASE_IS_DISPOSABLE';
const DISPOSABLE_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);
const DISPOSABLE_DATABASES = new Set(['travel_app']);
const DISPOSABLE_DATABASE_PATTERN = /_test$/;

function assertDisposableDatabase() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('Refusing to clear bookings: DATABASE_URL is not set.');
    }
    if (process.env[DISPOSABLE_MARKER] !== 'true') {
        throw new Error(
            `Refusing to clear bookings: ${DISPOSABLE_MARKER} is not set to "true" in this `
            + 'environment. This suite deletes every booking in the database it is pointed at, '
            + `so the environment has to say the data is expendable. Add ${DISPOSABLE_MARKER}=true `
            + 'to the .env you use for development and testing -- and never to one that deploys '
            + 'this application.'
        );
    }
    let host, name;
    try {
        const parsed = new URL(databaseUrl);
        host = parsed.hostname.replace(/^\[|\]$/g, '');
        name = parsed.pathname.replace(/^\//, '');
    } catch {
        throw new Error('Refusing to clear bookings: DATABASE_URL is not a URL this can check.');
    }
    if (!DISPOSABLE_HOSTS.has(host)) {
        throw new Error(
            `Refusing to clear bookings: DATABASE_URL points at host "${host}", which is not one `
            + `this suite may destroy data on (${[...DISPOSABLE_HOSTS].join(', ')}). `
            + 'Point DATABASE_URL at a local or Compose database before running the tests.'
        );
    }
    if (!DISPOSABLE_DATABASES.has(name) && !DISPOSABLE_DATABASE_PATTERN.test(name)) {
        throw new Error(
            `Refusing to clear bookings: DATABASE_URL names database "${name}", which this suite `
            + `does not own. Expected ${[...DISPOSABLE_DATABASES].join(', ')} or a name ending in `
            + '"_test". Being reachable on localhost is not enough -- a tunnel or a proxy puts a '
            + 'real database there too.'
        );
    }
}

module.exports = {
    assertDisposableDatabase,
    DISPOSABLE_MARKER,
    DISPOSABLE_HOSTS,
    DISPOSABLE_DATABASES,
    DISPOSABLE_DATABASE_PATTERN,
};
