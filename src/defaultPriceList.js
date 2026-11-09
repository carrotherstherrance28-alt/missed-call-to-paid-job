export const defaultPriceList = {
  business: {
    name: "Thurr Solutions",
    city: "St. Louis, MO",
    phone: "(314) 555-0198",
    email: "owner-demo@example.com",
    serviceArea: "St. Louis city and close-in county",
    depositPercent: 50,
    demo: true,
    disclaimer:
      "Demo for Thurr Solutions. PayPal stays on the sandbox. Phone and SMS run through Twilio only when those env vars are set; otherwise the shop board simulates them.",
  },
  items: [
    {
      id: "gate-repair",
      name: "Gate repair",
      detail: "Latch, hinge, or sag on an existing metal gate. One visit.",
      price: 175,
      unit: "job",
    },
    {
      id: "railing-section",
      name: "Steel railing section",
      detail: "Custom steel railing, materials included, per 4-foot section.",
      price: 380,
      unit: "section",
    },
    {
      id: "handrail-repair",
      name: "Handrail repair",
      detail: "Loose or broken interior or exterior handrail. One visit.",
      price: 160,
      unit: "job",
    },
    {
      id: "trailer-hitch",
      name: "Trailer hitch install",
      detail: "Labor to install a hitch the customer already bought.",
      price: 240,
      unit: "job",
    },
    {
      id: "mobile-weld-hour",
      name: "Mobile welding hour",
      detail: "On-site welding, billed per hour, one hour minimum.",
      price: 150,
      unit: "hour",
    },
  ],
};
