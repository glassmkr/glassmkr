// Public service catalog for status.glassmkr.com. The status app probes each
// service's URL and reports operational / outage based on the response. Keep
// this list to user-facing services only.

export interface PublicService {
  id: string;
  name: string;
  description: string;
  url: string;
}

export const PUBLIC_SERVICES: PublicService[] = [
  {
    id: "dashboard",
    name: "Glassmkr Dashboard",
    description: "Customer dashboard and ingest API",
    url: "https://app.glassmkr.com",
  },
  {
    id: "site",
    name: "glassmkr.com",
    description: "Marketing site and documentation",
    url: "https://glassmkr.com",
  },
];
