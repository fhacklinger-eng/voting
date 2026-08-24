export const DEFAULT_CATEGORIES = [
  { name: "Nachschlag-Faktor", question: "Wie lecker war’s?" },
  {
    name: "Das Auge isst mit",
    question: "Wie appetitlich sah das Essen aus?",
  },
  {
    name: "Küchen-Coup",
    question: "Wie kreativ und stimmig war das Menü?",
  },
  {
    name: "Punktlandung",
    question: "Haben Garpunkt, Temperatur und Timing gepasst?",
  },
  {
    name: "Gesamterlebnis",
    question: "Wie stimmig war der Abend insgesamt?",
  },
] as const;

export type ChallengeStatus = "preparation" | "running" | "revealed";
export type DinnerStatus = "upcoming" | "open" | "closed";
export type VoterRole = "captain" | "jury";

export interface ChallengeSetupInput {
  name: string;
  teams: Array<{
    id?: string;
    name: string;
    captainName: string;
    dinnerDate: string;
  }>;
  juryMembers?: Array<{
    id?: string;
    name: string;
  }>;
  categories?: Array<{
    id?: string;
    name: string;
    question: string;
  }>;
}

export interface NormalizedChallengeSetup {
  name: string;
  teams: Array<{
    id?: string;
    name: string;
    nameKey: string;
    captainName: string;
    dinnerDate: string;
  }>;
  juryMembers: Array<{
    id?: string;
    name: string;
    nameKey: string;
  }>;
  categories: Array<{
    id?: string;
    name: string;
    nameKey: string;
    question: string;
  }>;
}

export interface ChallengeConfiguration {
  id: string;
  name: string;
  status: ChallengeStatus;
  teams: Array<{
    id: string;
    name: string;
    captainName: string;
    dinner: {
      id: string;
      date: string;
      status: DinnerStatus;
    };
  }>;
  juryMembers: Array<{
    id: string;
    name: string;
  }>;
  categories: Array<{
    id: string;
    position: number;
    name: string;
    question: string;
  }>;
}

export class ConfigurationValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Bitte korrigiere die markierten Felder.");
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateChallengeSetup(input: unknown): NormalizedChallengeSetup {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawTeams = Array.isArray(record.teams) ? record.teams : [];
  const rawJuryMembers = Array.isArray(record.juryMembers) ? record.juryMembers : [];
  const rawCategories = Array.isArray(record.categories)
    ? record.categories
    : [...DEFAULT_CATEGORIES];
  const fieldErrors: Record<string, string> = {};

  const name = text(record.name);
  if (!name) fieldErrors.name = "Bitte gib der Challenge einen Namen.";

  if (rawTeams.length < 3) {
    fieldErrors.teams = "Lege mindestens drei Teams an.";
  }

  const teams = rawTeams.map((rawTeam, index) => {
    const team =
      rawTeam && typeof rawTeam === "object" ? (rawTeam as Record<string, unknown>) : {};
    const teamName = text(team.name);
    const captainName = text(team.captainName);
    const dinnerDate = text(team.dinnerDate);

    if (!teamName) fieldErrors[`teams.${index}.name`] = "Bitte gib einen Teamnamen ein.";
    if (!captainName) {
      fieldErrors[`teams.${index}.captainName`] = "Bitte gib den Captain an.";
    }
    if (!isCalendarDate(dinnerDate)) {
      fieldErrors[`teams.${index}.dinnerDate`] = "Bitte wähle ein gültiges Datum.";
    }

    return {
      id: text(team.id) || undefined,
      name: teamName,
      nameKey: nameKey(teamName),
      captainName,
      dinnerDate,
    };
  });

  const seenTeamNames = new Map<string, number>();
  const seenDates = new Map<string, number>();
  teams.forEach((team, index) => {
    const duplicateName = seenTeamNames.get(team.nameKey);
    if (team.nameKey && duplicateName !== undefined) {
      fieldErrors[`teams.${duplicateName}.name`] = "Teamnamen müssen eindeutig sein.";
      fieldErrors[`teams.${index}.name`] = "Teamnamen müssen eindeutig sein.";
    } else if (team.nameKey) {
      seenTeamNames.set(team.nameKey, index);
    }

    const duplicateDate = seenDates.get(team.dinnerDate);
    if (isCalendarDate(team.dinnerDate) && duplicateDate !== undefined) {
      fieldErrors[`teams.${duplicateDate}.dinnerDate`] = "Jeder Kochabend braucht ein eigenes Datum.";
      fieldErrors[`teams.${index}.dinnerDate`] = "Jeder Kochabend braucht ein eigenes Datum.";
    } else if (isCalendarDate(team.dinnerDate)) {
      seenDates.set(team.dinnerDate, index);
    }
  });

  const juryMembers = rawJuryMembers.map((rawMember, index) => {
    const member =
      rawMember && typeof rawMember === "object"
        ? (rawMember as Record<string, unknown>)
        : {};
    const name = text(member.name);
    if (!name) {
      fieldErrors[`juryMembers.${index}.name`] = "Bitte gib einen Namen für das Jury-Mitglied ein.";
    }
    return {
      id: text(member.id) || undefined,
      name,
      nameKey: nameKey(name),
    };
  });

  const seenJuryNames = new Map<string, number>();
  juryMembers.forEach((member, index) => {
    const duplicate = seenJuryNames.get(member.nameKey);
    if (member.nameKey && duplicate !== undefined) {
      fieldErrors[`juryMembers.${duplicate}.name`] = "Jury-Namen müssen eindeutig sein.";
      fieldErrors[`juryMembers.${index}.name`] = "Jury-Namen müssen eindeutig sein.";
    } else if (member.nameKey) {
      seenJuryNames.set(member.nameKey, index);
    }
  });

  if (rawCategories.length !== 5) {
    fieldErrors.categories = "Die Challenge benötigt genau fünf Kategorien.";
  }

  const categories = rawCategories.map((rawCategory, index) => {
    const category =
      rawCategory && typeof rawCategory === "object"
        ? (rawCategory as Record<string, unknown>)
        : {};
    const categoryName = text(category.name);
    const question = text(category.question);

    if (!categoryName) {
      fieldErrors[`categories.${index}.name`] = "Bitte gib einen Kategorienamen ein.";
    }
    if (!question) {
      fieldErrors[`categories.${index}.question`] = "Bitte ergänze die Leitfrage.";
    }

    return {
      id: text(category.id) || undefined,
      name: categoryName,
      nameKey: nameKey(categoryName),
      question,
    };
  });

  const seenCategoryNames = new Map<string, number>();
  categories.forEach((category, index) => {
    const duplicate = seenCategoryNames.get(category.nameKey);
    if (category.nameKey && duplicate !== undefined) {
      fieldErrors[`categories.${duplicate}.name`] = "Kategorienamen müssen eindeutig sein.";
      fieldErrors[`categories.${index}.name`] = "Kategorienamen müssen eindeutig sein.";
    } else if (category.nameKey) {
      seenCategoryNames.set(category.nameKey, index);
    }
  });

  if (Object.keys(fieldErrors).length > 0) {
    throw new ConfigurationValidationError(fieldErrors);
  }

  return { name, teams, juryMembers, categories };
}
