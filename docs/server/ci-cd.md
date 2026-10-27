# CI/CD and Continuous Delivery

The old way to ship a change onto a server was to SSH in and edit by hand: type commands, copy files, restart the service. One machine accumulates this set of manual steps, a second machine grows a slightly different set, and from the third machine on nobody can say anymore what is actually running in production. CI/CD turns "the change itself" into a repeatable pipeline: code lands in the repository and is automatically built and tested, and once it passes it is released according to a fixed strategy -- the same input always yields the same result, every step leaves a log, and failures can be rolled back. This page covers the anatomy of a pipeline, the trade-offs among the three mainstream platforms, the two forms of deliverable and how to choose a deployment strategy, and the red line of secrets management.

> Content draws on the official documentation of GitHub Actions, GitLab CI, and Jenkins (entry points verified reachable on 2026-10-10); see the references at the end.

## What This Page Covers

- Drawing the line between CI and CD: what integration verification, deliverable, and automatic release each mean
- The definition files and runner models of the three mainstream platforms
- Reading and writing a minimally usable pipeline definition
- Telling artifacts and images apart as the two forms of deliverable
- Choosing a deployment strategy, and setting the rule that secrets never enter the repository

## 1. Where the Two Words Part

**CI (continuous integration)**: every push is automatically built and tested, problems surface before merge, and branch lifetimes are compressed. **CD (continuous delivery)**: build outputs are always in a releasable state, and the release action is triggered on demand; one step further is continuous deployment -- after all checks pass, the change goes live automatically, unattended. Most teams land on "fully automated CI plus semi-automatic delivery", leaving that final go-live to a human judgment call.

The four inherent problems of manual deployment are digested by the pipeline in order: steps depend on human memory (the pipeline definition is the documentation); results are not reproducible (the environment is described by the definition file); the process is not auditable (every run leaves a complete log); rollback depends on memory (artifacts are versioned, so rollback is picking a version number).

## 2. The Three Mainstream Platforms

| Dimension | GitHub Actions | GitLab CI | Jenkins |
|------|---------------|-----------|---------|
| Definition file | `.github/workflows/*.yml` | `.gitlab-ci.yml` | `Jenkinsfile` |
| Execution model | hosted runners or self-hosted runners | built into the platform, or self-installed gitlab-runner | a standalone service, controller plus agent |
| Relationship to code hosting | deeply integrated with GitHub | integrated with GitLab | independent of the hosting platform |
| Hosted SaaS | offered by GitHub | offered by gitlab.com | you build it yourself |
| Best fit | code on GitHub, small and mid-size teams | already running self-hosted GitLab | complex legacy processes, heavy dependence on the plugin ecosystem |

The one-line selection rule: wherever your code is hosted, look at that platform's built-in pipeline solution first -- it has the lowest integration cost. Only when the hosting platform cannot satisfy you (internal build machines, special hardware, compliance requirements) do you self-host a runner, which does not require changing platforms. Jenkins's value lies in existing installations; it is now rare to start a new project on Jenkins. In self-hosted Git ecosystems, Gitea has Actions built in since 1.19; the official line is that it is designed to be compatible with GitHub Actions but differs in places (the official docs have a dedicated "Compared to GitHub Actions" page), so small teams can consider it as well.

## 3. Pipeline Anatomy

A GitHub Actions definition covering the minimal closed loop of "check on push":

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: shellcheck scripts/*.sh        # static checks
      - run: pytest tests/ -q               # unit tests
      - run: make build                     # build the artifact
      - uses: actions/upload-artifact@v4
        with:
          name: demo-app
          path: dist/
```

The structure has three layers: `on` defines triggers (push, PR, cron, tag), `jobs` defines parallel units, and `steps` defines serial actions. GitLab's equivalent is flatter -- in `.gitlab-ci.yml` every top-level block is a job, `stages: [test, build, deploy]` declares the execution stages, jobs in the same stage run in parallel and stages run in series, and `rules`/`only` control the triggers. The verbs differ between the two, but the skeleton is the same: trigger conditions -> checks and tests -> a versioned deliverable.

The pipeline has to be fast. Once tests take more than ten minutes, nobody wants to push small incremental commits and the team's behavior degenerates into batched mega-commits -- moving the slowest checks to before the merge and leaving the rest for after it works better than simply adding machines.

## 4. Artifacts and Images

Deliverables come in two forms, matching two deployment philosophies:

**Artifacts**: the package or binary the build produced -- tarballs, jars, compiled binaries. Deployment = put the artifact on the target machine and wire up a systemd unit. Suited to single-machine or small traditional deployments.

**Container images**: the artifact plus the entire userland environment it needs, packed into one immutable unit. Deployment = pull the image, start a new container, cut over the traffic. The image absorbs environment differences, and "it works on my machine" loses its breeding ground.

Both forms share one discipline: **deliverables carry versions**. Image tags use the git tag or the short commit hash, never `latest` -- `latest` is a gamble when you need to roll back, whereas `demo-app:20261010-a1b2c3d` is a coordinate you can point at. Immutable deployment flows from this: nothing on the server is edited by hand, any change goes through a new build and deployment, old image versions are kept, and rollback is just cutting the traffic back.

## 5. Deployment Strategies

| Strategy | Action | Rollback | Applies to |
|------|------|------|------|
| In-place update | stop the service, replace the files, `systemctl restart` | put the old artifact back and restart | single machine, minute-level downtime acceptable |
| Rolling update | replace one machine or instance at a time, next one only after the health check passes | roll back instance by instance | multiple instances, stateless services |
| Blue-green | two complete environments, traffic switched wholesale | switch back to the old environment | downtime is costly, resources affordable |
| Canary | run the new version on a small slice of traffic first, watch the metrics, then ramp up | cutting traffic back is the rollback | high traffic, mature observability |

The trade-off between scale and rollback cost runs through the whole table: single-machine in-place updates are the least fuss, provided you accept a downtime window; rolling updates on multi-instance stateless services are the default answer; blue-green and canary buy you "rollback in seconds" at the cost of more money and complexity. In every case, deployment should end at a systemd unit -- the unit semantics, `systemctl` status queries, and journal logs on the [systemd Services and Program Management](../system-management/services-systemd.md) page are the service-governance surface once the pipeline has landed. The minimal form of an in-place update in the systemd context: keep per-version directories under `/opt/demo-app`, point a `current` symlink at the version, `ExecStart=/opt/demo-app/current/bin/demo-app`, and rollback = change the symlink + restart.

## 6. The Secrets Red Line

Database passwords, API keys, private keys of certificates -- collectively called secrets -- there is only one rule: **they never enter the code repository**, not even a private one. Repository history is persistent; deleting it today leaves it in the history tomorrow; and repository access must eventually be granted to collaborators and CI systems.

The three-tier alternatives, in priority order: the CI platform's secrets mechanism (GitHub repository secrets, GitLab CI/CD variables) as the first tier, injected as environment variables, with the platform responsible for masking them in logs; where dedicated infrastructure exists, use a secret manager such as Vault, which supports rotation and auditing; at worst, pull from controlled storage at deployment time and tighten the on-disk permissions to 600. Two additions: split the same secret per environment (dev and prod always differ, so a test script can never touch production by accident); and after a leak, the response is **rotation**, not deleting the commit -- treat the old value as compromised, and only a new value stops the bleeding.

## 7. Common Failures

**The pipeline is all green, but production breaks on release.** The pipeline environment and the production environment are inconsistent: dependency versions, system libraries, and config values can all be cracks. The mitigation is environment layering (run tests in CI, rehearse deployments in staging) plus containerization (the image carries the environment along); the root cause is environment drift, not insufficient tests.

**The runner's disk is full.** Caches, old images, and historical artifacts pile up over time. Self-hosted runners need regular cleanup of build directories and dangling images, and the platform side needs an artifact retention period -- keeping ninety meaningless builds only trades for the opposite embarrassment of finding no usable artifact when you want to roll back.

**Secrets appear in the logs.** A program dumps all its environment variables, or an error stack trace carries a connection string. Run a `grep -r` self-check over sensitive variable names before the build; the platform's masking mechanism only hides known values and cannot catch custom formatted output.

**Concurrent deployments tread on each other.** Two branches trigger deployments at the same time, and a half-old-half-new state is harder to debug than fully old. Platforms all have concurrency controls (GitHub concurrency groups, GitLab resource_group); deployments to the same target queue up.

**There is no rollback plan.** You discover only when something breaks that old artifacts were never archived and the database migration is irreversible. Rollback capability is designed in: artifacts are retained per version, database changes stay backward compatible (expand before you drop), and it only counts once you have rehearsed it.

## Division of Labor with Other Pages

Managing machine state after a change lands (bulk package installation, config edits) belongs to [Automation](../system-management/automation.md) -- Ansible describes "what the machines should look like", CI/CD describes "how a change is repeatedly verified and released"; the two complement rather than compete. Container image build details are in [Containers](./container/docker.md); the SSH configuration of the deployment channel is in [SSH Remote Login](./ssh.md); post-delivery service governance and logs are in [systemd Services and Program Management](../system-management/services-systemd.md); after launch, metric observation hands off to [Monitoring](./monitoring/prometheus.md). The ops-automation reading path in the application scenarios section gives a recommended order for these pages.

## References

- GitHub Actions documentation -- [docs.github.com/actions](https://docs.github.com/actions)
- GitLab CI/CD documentation -- [docs.gitlab.com/ci/](https://docs.gitlab.com/ci/)
- Gitea Actions documentation (including the "Compared to GitHub Actions" page) -- [docs.gitea.com/usage/actions/](https://docs.gitea.com/usage/actions/)
- Jenkins user documentation -- [jenkins.io/doc/](https://www.jenkins.io/doc/)
- UNIX and Linux System Administration Handbook, 5th edition, chapter 26 (Continuous Integration and Delivery) -- [admin.com](https://www.admin.com/)
- man pages -- man systemd.unit, man systemctl

<!-- BACKLINKS-AUTO -->
## Related Pages

- [knowledge](/knowledge.md)
- [README](/research/README.md)
- [application-scenarios](/research/application-scenarios.md)
- [coverage-matrix](/research/coverage-matrix.md)
- [gap-fill](/research/gap-fill.md)
- [README](README.md)
- [cloud-computing](cloud-computing.md)