import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const REPO_ROOT = path.resolve(__dirname, '../..');
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, '.github/workflows/ci.yml');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'prisma/migrations');

interface WorkflowStep {
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, unknown>;
}

interface WorkflowJob {
    name?: string;
    'runs-on'?: string;
    services?: Record<string, {
        image?: string;
        ports?: (string | number)[];
        env?: Record<string, string>;
        options?: string;
    }>;
    env?: Record<string, string>;
    steps?: WorkflowStep[];
}

interface WorkflowConfig {
    name?: string;
    on?: {
        push?: {
            branches?: string[];
        };
        pull_request?: {
            branches?: string[];
        };
    };
    jobs?: Record<string, WorkflowJob>;
}

function stripSqlComments(sql: string): string {
    const withoutMultiLine = sql.replace(/\/\*[\s\S]*?\*\//g, '');
    const withoutSingleLine = withoutMultiLine.replace(/--.*$/gm, '');
    return withoutSingleLine.trim();
}

describe('Continuous Verification CI Workflow (.github/workflows/ci.yml)', () => {
    let workflowContent: string;
    let parsedWorkflow: WorkflowConfig;

    beforeAll(() => {
        expect(fs.existsSync(CI_WORKFLOW_PATH)).toBe(true);
        workflowContent = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
        expect(workflowContent.trim().length).toBeGreaterThan(0);
        parsedWorkflow = yaml.load(workflowContent) as WorkflowConfig;
        expect(parsedWorkflow).toBeDefined();
        expect(typeof parsedWorkflow).toBe('object');
    });

    it('exists and is valid YAML', () => {
        expect(parsedWorkflow).not.toBeNull();
        expect(parsedWorkflow.name).toBe('CI');
    });

    it('is triggered on push and pull_request to main', () => {
        const triggers = parsedWorkflow.on;
        expect(triggers).toBeDefined();
        expect(triggers?.push?.branches).toContain('main');
        expect(triggers?.pull_request?.branches).toContain('main');
    });

    it('contains required jobs: verify, security, and database', () => {
        const jobs = parsedWorkflow.jobs;
        expect(jobs).toBeDefined();
        expect(jobs).toHaveProperty('verify');
        expect(jobs).toHaveProperty('security');
        expect(jobs).toHaveProperty('database');
    });

    describe('verify job', () => {
        let verifyJob: WorkflowJob;

        beforeAll(() => {
            verifyJob = parsedWorkflow.jobs?.verify as WorkflowJob;
        });

        it('runs on ubuntu-latest', () => {
            expect(verifyJob['runs-on']).toBe('ubuntu-latest');
        });

        it('checks out code and sets up Node.js 20 with cache', () => {
            const steps = verifyJob.steps ?? [];
            const checkoutStep = steps.find(s => s.uses?.startsWith('actions/checkout'));
            expect(checkoutStep).toBeDefined();

            const setupNodeStep = steps.find(s => s.uses?.startsWith('actions/setup-node'));
            expect(setupNodeStep).toBeDefined();
            expect(String(setupNodeStep?.with?.['node-version'])).toBe('20');
            expect(setupNodeStep?.with?.cache).toBe('npm');
        });

        it('runs npm ci, npx prisma generate, npx tsc --noEmit, npm run lint, and npm run test:unit', () => {
            const steps = verifyJob.steps ?? [];
            const runCommands = steps.map(s => s.run).filter((cmd): cmd is string => Boolean(cmd));

            expect(runCommands.some(cmd => cmd.includes('npm ci'))).toBe(true);
            expect(runCommands.some(cmd => cmd.includes('npx prisma generate'))).toBe(true);
            expect(runCommands.some(cmd => cmd.includes('npx tsc --noEmit'))).toBe(true);
            expect(runCommands.some(cmd => cmd.includes('npm run lint'))).toBe(true);
            expect(runCommands.some(cmd => cmd.includes('npm run test:unit'))).toBe(true);
        });
    });

    describe('security job', () => {
        let securityJob: WorkflowJob;

        beforeAll(() => {
            securityJob = parsedWorkflow.jobs?.security as WorkflowJob;
        });

        it('runs on ubuntu-latest', () => {
            expect(securityJob['runs-on']).toBe('ubuntu-latest');
        });

        it('runs npm audit --audit-level=high', () => {
            const steps = securityJob.steps ?? [];
            const auditStep = steps.find(s => s.run?.includes('npm audit --audit-level=high'));
            expect(auditStep).toBeDefined();
        });

        it('includes secret scanning check', () => {
            const steps = securityJob.steps ?? [];
            const secretScanStep = steps.find(s =>
                s.name?.toLowerCase().includes('secret scan') ||
                s.run?.toLowerCase().includes('secret')
            );
            expect(secretScanStep).toBeDefined();
        });

        it('includes migration verification checking for SET LOCAL lock_timeout', () => {
            const steps = securityJob.steps ?? [];
            const migrationStep = steps.find(s =>
                s.name?.toLowerCase().includes('migration') &&
                s.run?.includes('SET LOCAL lock_timeout') &&
                s.run?.includes('3s')
            );
            expect(migrationStep).toBeDefined();
        });
    });

    describe('database job', () => {
        let databaseJob: WorkflowJob;

        beforeAll(() => {
            databaseJob = parsedWorkflow.jobs?.database as WorkflowJob;
        });

        it('runs on ubuntu-latest with a PostgreSQL service container', () => {
            expect(databaseJob['runs-on']).toBe('ubuntu-latest');
            const postgresService = databaseJob.services?.postgres;
            expect(postgresService).toBeDefined();
            expect(postgresService?.image).toContain('postgres');
            expect(postgresService?.ports).toBeDefined();
            expect(postgresService?.env?.POSTGRES_DB).toBe('travel_app');
        });

        it('runs migrations and database tests', () => {
            const steps = databaseJob.steps ?? [];
            const runCommands = steps.map(s => s.run).filter((cmd): cmd is string => Boolean(cmd));

            expect(runCommands.some(cmd => cmd.includes('npx prisma migrate deploy'))).toBe(true);
            expect(runCommands.some(cmd => cmd.includes('npm run test:database'))).toBe(true);
        });
    });
});

describe('Database Migrations Lock Timeout Verification', () => {
    const migrationDirs = fs.readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();

    it('reads all migration directories in prisma/migrations', () => {
        expect(migrationDirs.length).toBeGreaterThan(0);
    });

    it('all database migrations in prisma/migrations start with SET LOCAL lock_timeout = \'3s\';', () => {
        const expectedPrefix = "SET LOCAL lock_timeout = '3s';";

        for (const dirName of migrationDirs) {
            const sqlPath = path.join(MIGRATIONS_DIR, dirName, 'migration.sql');
            if (!fs.existsSync(sqlPath)) {
                continue;
            }

            const sqlContent = fs.readFileSync(sqlPath, 'utf8');
            const strippedSql = stripSqlComments(sqlContent);

            const startsWithLocalLockTimeout = strippedSql.startsWith(expectedPrefix);
            expect({
                migration: dirName,
                startsWithExpectedStatement: startsWithLocalLockTimeout,
            }).toEqual({
                migration: dirName,
                startsWithExpectedStatement: true,
            });
        }
    });
});
