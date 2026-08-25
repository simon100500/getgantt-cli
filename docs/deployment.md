# Release and deployment checklist

The CLI package and the GetGantt server are released independently. A CLI
release must not be published before the matching server API is available.

1. In a controlled deployment environment, apply the server migration against
   staging first:

   ```bash
   npm run prisma:migrate -w packages/runtime-core
   ```

   The migration creates `personal_access_tokens`; it is not applied by the
   application process and must never be run against production from a laptop.

2. Build and deploy the normal GetGantt image. The Fastify server registers the
   PAT settings routes and `/api/cli/v1` routes in the same image as the web
   application.

3. Create a test PAT in the account UI and verify, with a non-production test
   project:

   ```bash
   GETGANTT_TOKEN=ggt_pat_... gantt --server https://staging.example.com --json auth status
   GETGANTT_TOKEN=ggt_pat_... gantt --server https://staging.example.com --project <id> --json projects current
   ```

4. Publish the CLI only after the staging smoke passes:

   ```bash
   npm test
   npm publish --access public
   ```

5. Production smoke must use a dedicated test user/project. Verify token
   revocation, project allowlists, stale `baseVersion` rejection, and retrying
   one mutation with the same `Idempotency-Key`.

