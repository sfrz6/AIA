"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, RotateCcw, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Label, Switch } from "@/components/ui/form-controls";
import { Badge } from "@/components/ui/surfaces";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableWrapper, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/components/common/formatting";
import { PERMISSION_GROUPS, PERMISSIONS, type Permission } from "@/domain/permissions";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";
import {
  createUserAction,
  setUserActiveAction,
  updateUserAction,
} from "@/server/actions/users";

export interface UserRow {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly permissions: readonly string[];
}

const GROUP_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  setup: "users.groupSetup",
  participants: "users.groupParticipants",
  operations: "users.groupOperations",
  results: "users.groupResults",
};

interface FormState {
  readonly name: string;
  readonly username: string;
  readonly password: string;
  readonly isAdmin: boolean;
  readonly permissions: readonly Permission[];
}

const EMPTY_FORM: FormState = {
  name: "",
  username: "",
  password: "",
  isAdmin: false,
  permissions: [],
};

function formFor(user: UserRow): FormState {
  return {
    name: user.name,
    username: user.username,
    password: "",
    isAdmin: user.isAdmin,
    permissions: PERMISSIONS.filter((permission) => user.permissions.includes(permission)),
  };
}

export function UserManager({
  users,
  currentUserId,
}: {
  users: readonly UserRow[];
  currentUserId: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = React.useState<Readonly<Record<string, string>>>({});
  const [activeTarget, setActiveTarget] = React.useState<UserRow | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFieldErrors({});
    setDialogOpen(true);
  }

  function openEdit(user: UserRow) {
    setEditing(user);
    setForm(formFor(user));
    setFieldErrors({});
    setDialogOpen(true);
  }

  function togglePermission(permission: Permission, granted: boolean) {
    setForm((current) => ({
      ...current,
      permissions: granted
        ? [...current.permissions, permission]
        : current.permissions.filter((held) => held !== permission),
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFieldErrors({});
    const target = editing;

    startTransition(async () => {
      const payload = {
        name: form.name,
        username: form.username,
        isAdmin: form.isAdmin,
        permissions: form.permissions,
      };

      const result = target
        ? await updateUserAction({ ...payload, userId: target.id, password: form.password })
        : await createUserAction({ ...payload, password: form.password });

      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        toast.error(result.error);
        return;
      }

      setDialogOpen(false);
      toast.success(target ? t("users.updatedSuccess") : t("users.createdSuccess"));
      router.refresh();
    });
  }

  function toggleActive(user: UserRow) {
    startTransition(async () => {
      const result = await setUserActiveAction({ userId: user.id, active: !user.isActive });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setActiveTarget(null);
      toast.success(
        user.isActive ? t("users.deactivatedSuccess") : t("users.reactivatedSuccess"),
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>
          <Plus aria-hidden />
          {t("users.newUser")}
        </Button>
      </div>

      <TableWrapper>
        <Table>
          <THead>
            <Tr>
              <Th>{t("common.name")}</Th>
              <Th>{t("users.username")}</Th>
              <Th>{t("users.role")}</Th>
              <Th>{t("common.status")}</Th>
              <Th>{t("common.date")}</Th>
              <Th className="text-end">{t("common.actions")}</Th>
            </Tr>
          </THead>
          <TBody>
            {users.map((user) => (
              <Tr key={user.id}>
                <Td className="font-medium">{user.name}</Td>
                <Td className="text-muted">{user.username}</Td>
                <Td>
                  {user.isAdmin ? (
                    <Badge tone="primary">{t("users.administrator")}</Badge>
                  ) : (
                    <span className="text-sm text-muted">
                      {t("users.permissionsCount", { count: user.permissions.length })}
                    </span>
                  )}
                </Td>
                <Td>
                  {user.isActive ? (
                    <Badge tone="success">{t("users.active")}</Badge>
                  ) : (
                    <Badge tone="neutral">{t("users.inactive")}</Badge>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {formatDateTime(user.createdAt, locale)}
                </Td>
                <Td>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="iconSm"
                      variant="ghost"
                      onClick={() => openEdit(user)}
                      aria-label={`${t("common.edit")}: ${user.name}`}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    {user.isActive ? (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => setActiveTarget(user)}
                        disabled={user.id === currentUserId}
                        aria-label={`${t("users.deactivate")}: ${user.name}`}
                      >
                        <UserMinus aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => setActiveTarget(user)}
                        aria-label={`${t("users.reactivate")}: ${user.name}`}
                      >
                        <RotateCcw aria-hidden />
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </TableWrapper>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t("users.editUser") : t("users.newUser")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submit}>
            <DialogBody className="space-y-4">
              <Field
                label={t("users.fullName")}
                htmlFor="user-name"
                error={fieldErrors.name}
                required
              >
                <Input
                  id="user-name"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  maxLength={120}
                  autoComplete="off"
                  aria-invalid={fieldErrors.name ? true : undefined}
                />
              </Field>

              <Field
                label={t("users.username")}
                htmlFor="user-username"
                error={fieldErrors.username}
                required
              >
                <Input
                  id="user-username"
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  pattern="[a-zA-Z0-9._\-]{3,64}"
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={fieldErrors.username ? true : undefined}
                />
              </Field>

              <Field
                label={editing ? t("users.newPassword") : t("users.password")}
                htmlFor="user-password"
                hint={editing ? t("users.leaveBlankToKeep") : t("users.passwordHint")}
                error={fieldErrors.password}
                required={!editing}
              >
                <Input
                  id="user-password"
                  type="password"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  maxLength={128}
                  autoComplete="new-password"
                  aria-invalid={fieldErrors.password ? true : undefined}
                />
              </Field>

              <div className="flex items-start justify-between gap-4 rounded-md border border-border bg-surface-sunken px-3 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <Label htmlFor="user-is-admin">{t("users.administrator")}</Label>
                  <p className="text-xs text-muted">{t("users.administratorHint")}</p>
                </div>
                <Switch
                  id="user-is-admin"
                  checked={form.isAdmin}
                  onCheckedChange={(checked) => setForm({ ...form, isAdmin: checked })}
                  className="mt-1 shrink-0"
                />
              </div>

              <fieldset className="space-y-3" disabled={form.isAdmin}>
                <legend className="text-sm font-medium text-foreground">
                  {t("users.permissions")}
                </legend>
                {fieldErrors.permissions ? (
                  <p role="alert" className="text-xs font-medium text-danger">
                    {fieldErrors.permissions}
                  </p>
                ) : null}
                {PERMISSION_GROUPS.map((group) => (
                  <div key={group.id} className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {t(GROUP_LABEL_KEYS[group.id] ?? "users.permissions")}
                    </p>
                    <div className="space-y-1.5">
                      {group.permissions.map((permission) => (
                        <label
                          key={permission}
                          className="flex cursor-pointer items-center gap-2 text-sm"
                        >
                          <Checkbox
                            checked={form.isAdmin || form.permissions.includes(permission)}
                            disabled={form.isAdmin}
                            onCheckedChange={(checked) =>
                              togglePermission(permission, checked === true)
                            }
                          />
                          {t(`permissions.${permission}`)}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            </DialogBody>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDialogOpen(false)}
                disabled={pending}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={pending}>
                {editing ? t("common.save") : t("common.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={activeTarget !== null}
        onOpenChange={(open) => !open && setActiveTarget(null)}
        title={`${
          activeTarget?.isActive ? t("users.deactivate") : t("users.reactivate")
        }: ${activeTarget?.name ?? ""}`}
        description={
          activeTarget?.isActive ? t("users.confirmDeactivate") : t("users.confirmReactivate")
        }
        confirmLabel={activeTarget?.isActive ? t("users.deactivate") : t("users.reactivate")}
        cancelLabel={t("common.cancel")}
        destructive={activeTarget?.isActive === true}
        loading={pending}
        onConfirm={() => activeTarget && toggleActive(activeTarget)}
      />
    </div>
  );
}
