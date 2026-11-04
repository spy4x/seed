# Publish a release

> Also on the website: [seedsaas.com/docs/releases](https://seedsaas.com/docs/releases).

How a version tag publishes your product's images to Docker Hub.

**You need** the release pipeline set up as [the CI guide](woodpecker-ci-setup.md#releases) says,
and `IMAGE_PREFIX` set in [`.woodpecker/release.yml`](../.woodpecker/release.yml).

## Before the first release

Make your Docker Hub repositories private, unless the product is open source. A new Docker Hub
repository is public unless the account says otherwise, and the API image holds the whole source
tree, not only the build output.

Make `<IMAGE_PREFIX>-base`, `-api`, `-api-node`, `-api-bun`, `-spa` and `-mpa` private, or set the account's default
visibility to private, before the first tag.

## Releases

1. Switch to `main` and pull. The tag must point at a commit on `main`:

   ```sh
   git switch main && git pull --ff-only
   ```

2. Tag the release:

   ```sh
   git tag v1.2.3
   ```

3. Push the tag:

   ```sh
   git push origin v1.2.3
   ```

The pipeline publishes `<IMAGE_PREFIX>-api`, `-api-node`, `-api-bun`, `-spa` and `-mpa`. The worker
runs the API image of its runtime. It
refuses a tag whose commit is not on `main`.

A tag such as `v1.2.3-rc.1` publishes that tag only, never `latest`.

## Next

- [Deploy an update](deploy-updates.md)
- [The CI guide](woodpecker-ci-setup.md)
