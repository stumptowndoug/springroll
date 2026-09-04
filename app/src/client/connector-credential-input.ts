import type {
  ConnectionCardDto,
  ConnectorCredentialInputDto,
} from "../shared.ts";

export function connectorCredentialInput(
  card: ConnectionCardDto,
  apiKey: string,
  fields: Readonly<Record<string, string>>,
): ConnectorCredentialInputDto {
  return card.credentialFields?.length
    ? {
        fields: Object.fromEntries(
          card.credentialFields.map((field) => [
            field.name,
            fields[field.name] ?? "",
          ]),
        ),
      }
    : { apiKey };
}

export function connectorCredentialComplete(
  card: ConnectionCardDto,
  apiKey: string,
  fields: Readonly<Record<string, string>>,
): boolean {
  return card.credentialFields?.length
    ? card.credentialFields.every((field) =>
        Boolean(fields[field.name]?.trim()),
      )
    : Boolean(apiKey.trim());
}
