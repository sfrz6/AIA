import { requirePageUser } from "@/lib/auth/page-guards";
import { hasPermission } from "@/domain/permissions";
import { getTranslator } from "@/lib/i18n/server";
import {
  listChampionshipClubs,
  listChampionshipRiders,
} from "@/server/services/championships";
import { hasChampionshipStarted } from "@/server/services/championship-setup";
import { listClubsWithRiderCounts, listRidersForClub } from "@/server/services/registry";
import {
  ParticipantsManager,
  type AvailableClub,
  type ParticipantClub,
  type ParticipantSquadRider,
} from "./participants-manager";

export default async function ParticipantsPage({
  params,
}: {
  params: Promise<{ championshipId: string }>;
}) {
  const principal = await requirePageUser();
  const { championshipId } = await params;
  const { locale } = await getTranslator();

  const canManageRiders = hasPermission(principal, "MANAGE_RIDERS");
  const canManageClubs = hasPermission(principal, "MANAGE_CHAMPIONSHIP_CLUBS");

  const [participants, nominated, started] = await Promise.all([
    listChampionshipClubs(championshipId, locale),
    listChampionshipRiders(championshipId, locale),
    hasChampionshipStarted(championshipId),
  ]);

  // The pickers need every club's registry, so it is read here for the
  // clubs that already take part. The dialog that adds a club reads the
  // registry of its chosen club through a server action instead.
  const registries = canManageRiders
    ? await Promise.all(
        participants.map((participant) => listRidersForClub(participant.clubId)),
      )
    : [];

  const clubs: readonly ParticipantClub[] = participants.map((participant, index) => {
    const squad: readonly ParticipantSquadRider[] = nominated
      .filter((rider) => rider.championshipClubId === participant.championshipClubId)
      .map((rider) => ({
        riderId: rider.riderId,
        fullName: rider.fullName,
        rosterSlot: rider.rosterSlot,
        initialOrder: rider.initialOrder,
      }));

    return {
      championshipClubId: participant.championshipClubId,
      clubId: participant.clubId,
      name: participant.name,
      squad,
      registry: (registries[index] ?? []).map((rider) => ({
        id: rider.id,
        fullName: rider.fullName,
      })),
    };
  });

  const taken = new Set(participants.map((participant) => participant.clubId));
  const availableClubs: readonly AvailableClub[] = canManageClubs
    ? (await listClubsWithRiderCounts(locale))
        .filter((club) => !taken.has(club.id))
        .map((club) => ({
          id: club.id,
          name: club.name,
          riderCount: club.riderCount,
        }))
    : [];

  return (
    <ParticipantsManager
      championshipId={championshipId}
      clubs={clubs}
      availableClubs={availableClubs}
      canManageRiders={canManageRiders}
      canManageClubs={canManageClubs}
      championshipStarted={started}
    />
  );
}
