export interface TnvedGroup {
  code: string;
  name: string;
  groupId: number;
  productGroup: string;
}

export const TNVED_GROUPS: TnvedGroup[] = [
  { code: "3303", name: "Духи и туалетная вода", groupId: 4, productGroup: "perfumery" },

  { code: "4203", name: "Предметы одежды из кожи", groupId: 8, productGroup: "lp" },
  { code: "6101", name: "Пальто, полупальто мужские трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6102", name: "Пальто, полупальто женские трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6103", name: "Костюмы мужские трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6104", name: "Костюмы женские трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6105", name: "Рубашки мужские трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6106", name: "Блузки женские трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6107", name: "Трусы, ночные рубашки мужские трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6108", name: "Комбинации, ночные рубашки женские трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6109", name: "Футболки, майки трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6110", name: "Джемперы, пуловеры трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6111", name: "Одежда для младенцев трикотажная", groupId: 8, productGroup: "lp" },
  { code: "6112", name: "Спортивные костюмы трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6113", name: "Одежда трикотажная прочая", groupId: 8, productGroup: "lp" },
  { code: "6114", name: "Одежда трикотажная прочая", groupId: 8, productGroup: "lp" },
  { code: "6115", name: "Колготки, чулки, носки трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6116", name: "Перчатки трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6117", name: "Принадлежности одежды трикотажные", groupId: 8, productGroup: "lp" },
  { code: "6201", name: "Пальто мужские тканые", groupId: 8, productGroup: "lp" },
  { code: "6202", name: "Пальто женские тканые", groupId: 8, productGroup: "lp" },
  { code: "6203", name: "Костюмы, пиджаки, брюки мужские тканые", groupId: 8, productGroup: "lp" },
  { code: "6204", name: "Костюмы, платья, юбки женские тканые", groupId: 8, productGroup: "lp" },
  { code: "6205", name: "Рубашки мужские тканые", groupId: 8, productGroup: "lp" },
  { code: "6206", name: "Блузки женские тканые", groupId: 8, productGroup: "lp" },
  { code: "6207", name: "Майки мужские тканые", groupId: 8, productGroup: "lp" },
  { code: "6208", name: "Майки женские тканые", groupId: 8, productGroup: "lp" },
  { code: "6209", name: "Одежда для младенцев тканая", groupId: 8, productGroup: "lp" },
  { code: "6210", name: "Одежда из нетканых материалов", groupId: 8, productGroup: "lp" },
  { code: "6211", name: "Спортивные костюмы тканые", groupId: 8, productGroup: "lp" },
  { code: "6212", name: "Бюстгальтеры, корсеты", groupId: 8, productGroup: "lp" },
  { code: "6213", name: "Носовые платки", groupId: 8, productGroup: "lp" },
  { code: "6214", name: "Шали, шарфы", groupId: 8, productGroup: "lp" },
  { code: "6215", name: "Галстуки", groupId: 8, productGroup: "lp" },
  { code: "6216", name: "Перчатки тканые", groupId: 8, productGroup: "lp" },
  { code: "6217", name: "Принадлежности одежды тканые", groupId: 8, productGroup: "lp" },

  { code: "6401", name: "Обувь водонепроницаемая", groupId: 9, productGroup: "shoes" },
  { code: "6402", name: "Обувь прочая с подошвой из резины", groupId: 9, productGroup: "shoes" },
  { code: "6403", name: "Обувь с подошвой из резины, верх из кожи", groupId: 9, productGroup: "shoes" },
  { code: "6404", name: "Обувь с подошвой из резины, верх из текстиля", groupId: 9, productGroup: "shoes" },
  { code: "6405", name: "Обувь прочая", groupId: 9, productGroup: "shoes" },

  { code: "6301", name: "Одеяла", groupId: 14, productGroup: "linen" },
  { code: "6302", name: "Бельё постельное, столовое", groupId: 14, productGroup: "linen" },
  { code: "6303", name: "Занавески, шторы", groupId: 14, productGroup: "linen" },
  { code: "6304", name: "Прочие готовые текстильные изделия", groupId: 14, productGroup: "linen" },

  { code: "4011", name: "Шины пневматические новые резиновые", groupId: 5, productGroup: "tires" },

  { code: "9006", name: "Фотокамеры (кроме кинокамер)", groupId: 13, productGroup: "photo" },

  { code: "3304", name: "Средства для макияжа и ухода за кожей", groupId: 4, productGroup: "perfumery" },

  { code: "0401", name: "Молоко и сливки", groupId: 18, productGroup: "milk" },
  { code: "0402", name: "Молоко и сливки сгущённые", groupId: 18, productGroup: "milk" },
  { code: "0403", name: "Кефир, йогурт", groupId: 18, productGroup: "milk" },
  { code: "0404", name: "Молочная сыворотка", groupId: 18, productGroup: "milk" },
  { code: "0405", name: "Сливочное масло", groupId: 18, productGroup: "milk" },
  { code: "0406", name: "Сыры и творог", groupId: 18, productGroup: "milk" },

  { code: "2201", name: "Воды, включая минеральные", groupId: 16, productGroup: "water" },

  { code: "2202", name: "Воды газированные с сахаром", groupId: 16, productGroup: "water" },
  { code: "2203", name: "Пиво", groupId: 15, productGroup: "beer" },

  { code: "3808", name: "Инсектициды, антисептики", groupId: 21, productGroup: "antiseptic" },

  { code: "8712", name: "Велосипеды и прочие транспортные средства", groupId: 22, productGroup: "bicycles" },

  { code: "8713", name: "Кресла-коляски для инвалидов", groupId: 23, productGroup: "wheelchairs" },

  { code: "2401", name: "Табак необработанный", groupId: 1, productGroup: "tobacco" },
  { code: "2402", name: "Сигары, сигареты, сигариллы", groupId: 1, productGroup: "tobacco" },
  { code: "2403", name: "Прочий промышленно изготовленный табак", groupId: 1, productGroup: "tobacco" },

  { code: "2404", name: "Никотинсодержащая продукция", groupId: 7, productGroup: "nicotine" },

  { code: "8543", name: "Электрические машины (электронные сигареты)", groupId: 7, productGroup: "nicotine" },

  { code: "8708", name: "Части и принадлежности для автомобилей", groupId: 34, productGroup: "automotive" },
  { code: "8421", name: "Фильтры масляные, воздушные, топливные", groupId: 34, productGroup: "automotive" },
  { code: "8507", name: "Аккумуляторы электрические", groupId: 34, productGroup: "automotive" },
  { code: "8512", name: "Электрооборудование, фары автомобилей", groupId: 34, productGroup: "automotive" },
  { code: "6813", name: "Тормозные колодки и накладки", groupId: 34, productGroup: "automotive" },
  { code: "7009", name: "Зеркала заднего вида", groupId: 34, productGroup: "automotive" },
];

export function searchTnved(query: string): TnvedGroup[] {
  const q = query.toLowerCase().trim();
  if (!q) return TNVED_GROUPS;
  return TNVED_GROUPS.filter(
    (g) => g.code.includes(q) || g.name.toLowerCase().includes(q),
  );
}

export function getTnvedByCode(code: string): TnvedGroup | undefined {
  return TNVED_GROUPS.find((g) => g.code === code || code.startsWith(g.code));
}
