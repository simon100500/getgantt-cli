# Release and deployment checklist

GetGantt server and getgantt-cli are released independently, but the CLI must
not depend on an API operation that is not deployed yet.

## Server deployment

1. Deploy the server version that supports the CLI operation.
2. Create a dedicated test PAT and verify the staging API:

       GETGANTT_TOKEN=ggt_pat_... gantt --server https://staging.example.com --json auth status
       GETGANTT_TOKEN=ggt_pat_... gantt --server https://staging.example.com --project <id> --json project show

3. Run read and mutation smoke tests against a non-production project. Check
   project access, scope failures, stale baseVersion rejection, and server-side
   dry-run behavior.

## npm Trusted Publishing

The repository workflow publishes only a non-prerelease GitHub Release whose
tag starts with v. Configure the npm Trusted Publisher for:

       Owner: simon100500
       Repository: getgantt-cli
       Workflow: publish.yml
       Permission: npm publish

The workflow receives an OIDC token through id-token: write; it does not use an
NPM_TOKEN secret. The package must be public in npm for public releases.

## CLI release

From a clean main branch:

       npm ci
       npm test
       npm pack --dry-run

Then:

1. update the package version and lock-file version;
2. create and push a tag such as v0.2.0;
3. create a GitHub Release for that tag;
4. publish the Release, not as draft or prerelease;
5. monitor the Publish CLI to npm workflow and confirm the version:

       npm view getgantt-cli version

The workflow checks out the release tag, installs with npm ci, runs npm test,
and publishes with npm publish. After a failed run, check whether npm already
accepted the version before retrying.

## Production smoke

Use a dedicated test user and project. Verify:

- auth status succeeds with the intended scopes;
- only allowed projects appear in projects list;
- a read command returns the expected graph version;
- a mutation dry-run does not change the graph;
- a committed mutation returns a receipt and a new version;
- revoking the PAT blocks subsequent requests;
- a stale graph version returns a conflict and is not blindly overwritten.
