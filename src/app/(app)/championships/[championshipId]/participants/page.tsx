import { requirePageUser } from "@/lib/auth/page-guards";
import { hasPermission } from "@/domain/permissions";
import { getTranslator } from "@/lib/i18n/server";
import {
  listChampionshipCountries,
  listChampionshipRiders,
} from "@/server/services/championships";
import { hasChampionshipStarted } from "@/server/services/championship-setup";
import { listCountriesWithRiderCounts, listRidersForCountry } from "@/server/services/registry";
import {
  ParticipantsManager,
  type AvailableCountry,
  type ParticipantCountry,
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
  const canManageCountries = hasPermission(principal, "MANAGE_CHAMPIONSHIP_COUNTRIES");

  const [participants, nominated, started] = await Promise.all([
    listChampionshipCountries(championshipId, locale),
    listChampionshipRiders(championshipId, locale),
    hasChampionshipStarted(championshipId),
  ]);

  // The pickers need every country's registry, so it is read here for the
  // countries that already take part. The dialog that adds a country reads the
  // registry of its chosen country through a server action instead.
  const registries = canManageRiders
    ? await Promise.all(
        participants.map((participant) => listRidersForCountry(participant.countryId)),
      )
    : [];

  const countries: readonly ParticipantCountry[] = participants.map((participant, index) => {
    const squad: readonly ParticipantSquadRider[] = nominated
      .filter((rider) => rider.championshipCountryId === participant.championshipCountryId)
      .map((rider) => ({
        riderId: rider.riderId,
        fullName: rider.fullName,
        rosterSlot: rider.rosterSlot,
        initialOrder: rider.initialOrder,
      }));

    return {
      championshipCountryId: participant.championshipCountryId,
      countryId: participant.countryId,
      iso2: participant.iso2,
      name: participant.name,
      squad,
      registry: (registries[index] ?? []).map((rider) => ({
        id: rider.id,
        fullName: rider.fullName,
      })),
    };
  });

  const taken = new Set(participants.map((participant) => participant.countryId));
  const availableCountries: readonly AvailableCountry[] = canManageCountries
    ? (await listCountriesWithRiderCounts(locale))
        .filter((country) => !taken.has(country.id))
        .map((country) => ({
          id: country.id,
          iso2: country.iso2,
          name: country.name,
          riderCount: country.riderCount,
        }))
    : [];

  return (
    <ParticipantsManager
      championshipId={championshipId}
      countries={countries}
      availableCountries={availableCountries}
      canManageRiders={canManageRiders}
      canManageCountries={canManageCountries}
      championshipStarted={started}
    />
  );
}
