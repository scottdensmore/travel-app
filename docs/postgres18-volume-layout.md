# PostgreSQL 18 volume layout

Compose uses the PostgreSQL 18 image with `PGDATA=/var/lib/postgresql/18/docker` and mounts `db_data` at `/var/lib/postgresql`.
The read-only entrypoint wrapper refuses legacy cluster markers at the volume root or its `data/` subdirectory before delegating to the image's normal entrypoint. It never moves, deletes, upgrades, or initializes data itself.

## Existing PostgreSQL 15 volumes

Changing the image tag or moving files does not upgrade PostgreSQL's database format. Do not remove an existing volume to work around the guard.

Before rollout:

1. Identify and preserve the existing volume; retain a verified backup and a tested rollback path.
2. Rehearse a supported upgrade or logical dump/restore using a separate copy and isolated database instance. Do not mount the live PostgreSQL 15 volume into PostgreSQL 18.
3. Validate the upgraded copy, application migrations and database behavior against PostgreSQL 18. Existing hosted database CI currently uses PostgreSQL 15.
4. Arrange an owner-approved rollout and rollback window. This repository change does not perform a live migration.

Read-only layout checks can be run against a copied volume directory:

```sh
sh deploy/postgres-layout-guard.sh --check-layout /path/to/copied-volume-root
```

An empty root or an existing `18/docker` layout can pass this structural check. That does not prove database-version compatibility, backup validity, or a successful migration.

## Validation

`node --test scripts/check-postgres-layout.mjs` exercises synthetic empty/current/legacy/mixed layouts, path quoting, missing roots and argument validation, and verifies fixture files remain unchanged.
`npm run verify:repo` includes these checks. The wrapper/Compose mapping is also statically validated for this change. A real PostgreSQL 18 container startup and migration/restore rehearsal remain required before deployment; neither is represented by the synthetic checks.

Official image layout reference: [PostgreSQL Docker image PGDATA documentation](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata).
