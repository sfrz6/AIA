"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Eye, EyeOff, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/surfaces";
import { useI18n } from "@/lib/i18n/client";
import {
  setChampionshipPublishedAction,
  updateChampionshipAction,
} from "@/server/actions/championships";

export interface ChampionshipSettingsData {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly location: string;
  readonly organizer: string | null;
  readonly status: "DRAFT" | "ACTIVE" | "COMPLETED";
  readonly isPublished: boolean;
  readonly slug: string;
}

export function ChampionshipSettings({
  championship,
  canEdit,
  canPublish,
}: {
  championship: ChampionshipSettingsData;
  canEdit: boolean;
  canPublish: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [form, setForm] = React.useState({
    name: championship.name,
    nameAr: championship.nameAr ?? "",
    location: championship.location,
    organizer: championship.organizer ?? "",
    status: championship.status,
  });

  function save(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateChampionshipAction({
        championshipId: championship.id,
        name: form.name.trim(),
        nameAr: form.nameAr.trim() || null,
        location: form.location.trim(),
        organizer: form.organizer.trim() || null,
        status: form.status,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
      toast.success(t("championships.updatedSuccess"));
      router.refresh();
    });
  }

  function togglePublished() {
    startTransition(async () => {
      const result = await setChampionshipPublishedAction({
        championshipId: championship.id,
        published: !championship.isPublished,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("championships.updatedSuccess"));
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("championships.overview")}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {championship.isPublished ? (
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/results/${championship.slug}`} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                {t("publicResults.viewResults")}
              </Link>
            </Button>
          ) : null}
          {canPublish ? (
            <Button variant="secondary" size="sm" loading={pending} onClick={togglePublished}>
              {championship.isPublished ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              {championship.isPublished
                ? t("championships.unpublish")
                : t("championships.publish")}
            </Button>
          ) : null}
          {canEdit && !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              {t("common.edit")}
            </Button>
          ) : null}
        </div>
      </CardHeader>

      {editing ? (
        <CardContent>
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
            <Field label={t("championships.championshipName")} htmlFor="ch-name" required>
              <Input
                id="ch-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                maxLength={160}
                required
              />
            </Field>
            <Field label={t("championships.championshipNameAr")} htmlFor="ch-name-ar">
              <Input
                id="ch-name-ar"
                dir="rtl"
                value={form.nameAr}
                onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
                maxLength={160}
              />
            </Field>
            <Field label={t("championships.location")} htmlFor="ch-location" required>
              <Input
                id="ch-location"
                value={form.location}
                onChange={(event) => setForm({ ...form, location: event.target.value })}
                maxLength={160}
                required
              />
            </Field>
            <Field label={t("championships.organizer")} htmlFor="ch-organizer">
              <Input
                id="ch-organizer"
                value={form.organizer}
                onChange={(event) => setForm({ ...form, organizer: event.target.value })}
                maxLength={160}
              />
            </Field>
            <Field label={t("common.status")} htmlFor="ch-status">
              <Select
                id="ch-status"
                value={form.status}
                onChange={(event) =>
                  setForm({
                    ...form,
                    status: event.target.value as ChampionshipSettingsData["status"],
                  })
                }
              >
                <option value="DRAFT">{t("championships.statusDraft")}</option>
                <option value="ACTIVE">{t("championships.statusActive")}</option>
                <option value="COMPLETED">{t("championships.statusCompleted")}</option>
              </Select>
            </Field>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Button type="submit" loading={pending}>
                {t("common.save")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </form>
        </CardContent>
      ) : null}
    </Card>
  );
}
