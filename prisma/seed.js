// Seed credit packages
await prisma.creditPackage.createMany({
  data: [
    {
      name: "AI Chat Basic",
      credit_type: "AI_CHAT",
      credits: 200,
      price: 25000,
      description: "200 AI chat credits",
    },
    {
      name: "AI Chat Pro",
      credit_type: "AI_CHAT",
      credits: 500,
      price: 50000,
      description: "500 AI chat credits",
    },
    {
      name: "AI Chat Premium",
      credit_type: "AI_CHAT",
      credits: 1000,
      price: 90000,
      description: "1000 AI chat credits",
    },
    {
      name: "TTS Basic",
      credit_type: "TTS",
      credits: 20,
      price: 25000,
      description: "20 Text-to-Speech credits",
    },
    {
      name: "TTS Pro",
      credit_type: "TTS",
      credits: 50,
      price: 50000,
      description: "50 Text-to-Speech credits",
    },
    {
      name: "TTS Premium",
      credit_type: "TTS",
      credits: 100,
      price: 90000,
      description: "100 Text-to-Speech credits",
    },
  ],
}); 