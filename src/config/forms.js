const FORM_DEFINITIONS = {
  teamApplication: {
    id: "teamApplication",
    title: "📨 Заявка в команду",
    questions: [
      {
        key: "source",
        label: "Источник",
        prompt: "Откуда Вы узнали о нас?",
      },
      {
        key: "experience",
        label: "Опыт",
        prompt: "У вас есть опыт работы в такой сфере?",
      },
    ],
  },
};

module.exports = { FORM_DEFINITIONS };
