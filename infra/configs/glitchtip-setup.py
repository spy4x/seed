"""GlitchTip's side of `deno task errors:setup` (infra/scripts/errors-setup.ts).

Runs inside the `errors` container, GlitchTip, which mounts this file, and makes what the project
reports to: the operator's superuser, an organization named after the project, a team holding
both, and two projects, `api` and `spa`. Each is looked up first and made only when missing, so a second run
changes nothing; an existing user keeps the password it has. Read from the environment:
SETUP_ORGANIZATION, SETUP_ADMIN_EMAIL and SETUP_ADMIN_PASSWORD.

Prints one line of JSON last: each project's DSN and what this run made. Nothing else it prints
holds a secret.
"""

import json
import os
import sys

sys.path.insert(0, "/code")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "glitchtip.settings")

import django  # noqa: E402

django.setup()

from allauth.account.models import EmailAddress  # noqa: E402
from django.db import transaction  # noqa: E402

from apps.organizations_ext.models import Organization  # noqa: E402
from apps.projects.models import Project, ProjectKey  # noqa: E402
from apps.teams.models import Team  # noqa: E402
from apps.users.models import User  # noqa: E402

PROJECTS = ("api", "spa")


def main():
    organization_name = os.environ["SETUP_ORGANIZATION"]
    email = os.environ["SETUP_ADMIN_EMAIL"]
    password = os.environ["SETUP_ADMIN_PASSWORD"]
    made = []
    with transaction.atomic():
        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            user = User.objects.create_superuser(email=email, password=password)
            made.append("superuser")
        # No mail is configured, so the address can never be confirmed by mail.
        EmailAddress.objects.get_or_create(
            user=user, email=user.email, defaults={"primary": True, "verified": True}
        )

        # By name, not by slug: GlitchTip changes a reserved or all-digit name's slug.
        organization = (
            Organization.objects.filter(name=organization_name).order_by("pk").first()
        )
        if organization is None:
            organization = Organization.objects.create(name=organization_name)
            made.append("organization")
        if not organization.users.filter(pk=user.pk).exists():
            organization.add_user(user)

        team, created = Team.objects.get_or_create(
            organization=organization, slug="seed"
        )
        if created:
            made.append("team")
        team.members.add(organization.organization_users.get(user=user))

        dsns = {}
        for name in PROJECTS:
            project = (
                Project.objects.filter(organization=organization, name=name)
                .order_by("pk")
                .first()
            )
            if project is None:
                # Saving a new project makes its first key.
                project = Project.objects.create(organization=organization, name=name)
                made.append(f"project {name}")
            team.projects.add(project)
            key = (
                ProjectKey.objects.filter(project=project, is_active=True)
                .order_by("pk")
                .first()
            )
            if key is None:
                key = ProjectKey.objects.create(project=project)
                made.append(f"key {name}")
            dsns[name] = key.get_dsn()

    print(json.dumps({"dsns": dsns, "made": made}))


main()
