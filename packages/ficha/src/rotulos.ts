/**
 * Rótulos de exibição dos valores enumerados dos esquemas. Os valores gravados ficam sem
 * acento e em snake_case (estáveis para análise); a interface e os relatórios mostram estes rótulos.
 * Um teste garante que todo valor de todos os esquemas tem rótulo aqui.
 */
export const ROTULOS: Record<string, string> = {
  // gerais
  nenhuma: "Nenhuma", nenhum: "Nenhum", outro: "Outro", nao: "Não", normal: "Normal",
  direito: "Direito", esquerdo: "Esquerdo", ambos: "Ambos",

  // história médica e odontológica
  cardiaca: "Cardíaca", respiratoria: "Respiratória", neurologica: "Neurológica",
  gastrointestinal: "Gastrointestinal", genitourinaria: "Geniturinária",
  periodontal: "Periodontal", ortodontico: "Ortodôntico", restaurador: "Restaurador",
  endodontico: "Endodôntico", cirurgia_bucal: "Cirurgia bucal",
  sangramento_gengival: "Sangramento gengival", sangramento_na_escovacao: "Sangramento na escovação",
  sangramento_na_mastigacao: "Sangramento na mastigação", sangramento_espontaneo: "Sangramento espontâneo",
  dentes_amolecidos: "Dentes amolecidos", dificuldade_para_mastigar: "Dificuldade para mastigar",
  mau_halito: "Mau hálito", mau_gosto: "Mau gosto",
  media: "Média", macia: "Macia", dura: "Dura",
  fio_dental: "Fio dental", palito: "Palito", passador_de_fio: "Passador de fio",
  escova_interdental: "Escova interdental", bochecho: "Bochecho",

  // questionário de dor
  o_tempo_todo: "O tempo todo", aparece_e_desaparece: "Aparece e desaparece", somente_uma_vez: "Ocorreu somente uma vez",
  sim_ultimos_6_meses: "Sim, nos últimos 6 meses", sim_ha_mais_de_6_meses: "Sim, há mais de 6 meses",
  mastigar: "Mastigar", beber: "Beber (líquidos)", exercicios_fisicos: "Exercícios físicos",
  comer_alimentos_duros: "Comer alimentos duros", comer_alimentos_moles: "Comer alimentos moles",
  sorrir: "Sorrir", atividade_intima: "Atividade íntima/beijo", limpar_dentes_ou_face: "Limpar os dentes ou a face",
  bocejar: "Bocejar", engolir: "Engolir", conversar: "Conversar",
  manter_rosto_normal: "Manter o rosto sem aparência de dor",

  // exame de DTM
  articulacao: "Articulação", musculos: "Músculos",
  reto: "Reto", desvio_lateral_direito: "Desvio lateral direito", desvio_lateral_esquerdo: "Desvio lateral esquerdo",
  estalido: "Estalido", crepitacao_grosseira: "Crepitação grosseira", crepitacao_fina: "Crepitação fina",

  // prótese
  pt_dupla: "PT dupla", pt_unimaxilar: "PT unimaxilar", ppr: "PPR",
  fixa_sobre_implante: "Fixa sobre implante", protese_esqueletica: "Prótese esquelética",

  // RDC/TMD Eixo I
  Ia_dor_miofascial: "Ia · Dor miofascial",
  Ib_dor_miofascial_com_limitacao_abertura: "Ib · Dor miofascial com limitação de abertura",
  IIa_com_reducao: "IIa · Deslocamento do disco com redução",
  IIb_sem_reducao_com_limitacao: "IIb · Sem redução, com limitação de abertura",
  IIc_sem_reducao_sem_limitacao: "IIc · Sem redução, sem limitação de abertura",
  IIIa_artralgia: "IIIa · Artralgia", IIIb_osteoartrite: "IIIb · Osteoartrite", IIIc_osteoartrose: "IIIc · Osteoartrose",
  sem_diagnostico: "Sem diagnóstico",

  // exame extraoral
  alta: "Alta", baixa: "Baixa", invertida: "Invertida",
  competente: "Competente", incompetente: "Incompetente", ativos: "Ativos", passivos: "Passivos",
  longos: "Longos", medios: "Médios", curtos: "Curtos", grossos: "Grossos", finos: "Finos",
  normotonico: "Normotônico", hipertonico: "Hipertônico", hipotonico: "Hipotônico",
  mesofacial: "Mesofacial", braquifacial: "Braquifacial", dolicofacial: "Dolicofacial",
  oval: "Oval", triangular: "Triangular", quadrada: "Quadrada",
  convexo: "Convexo", concavo: "Côncavo",
  normodivergente: "Normodivergente", hiperdivergente: "Hiperdivergente", hipodivergente: "Hipodivergente",
  estalo: "Estalo", crepitacao: "Crepitação",

  // exame intraoral
  macroglossia: "Macroglossia", microglossia: "Microglossia", profundo: "Profundo", raso: "Raso",
  fluida: "Fluida", viscosa: "Viscosa", xerostomia: "Xerostomia",
  classe_I: "Classe I", classe_II: "Classe II", classe_III: "Classe III",
  profunda: "Profunda", aberta: "Aberta", cruzada: "Cruzada", tesoura: "Tesoura",
  suporte_oclusal: "Suporte oclusal", choque_de_molar: "Choque de molar", sindrome_de_compensacao: "Síndrome de compensação",
  aumentada: "Aumentada", diminuida: "Diminuída",
  guia_canino: "Guia canino", funcao_em_grupo_parcial: "Função em grupo parcial", funcao_em_grupo_total: "Função em grupo total",
  com_guia: "Com guia", sem_guia: "Sem guia",
  protrusiva: "Protrusiva", lateralidade_esquerda: "Lateralidade esquerda", lateralidade_direita: "Lateralidade direita",
  lingua: "Língua", mucosa: "Mucosa", labios: "Lábios",
  quadrado: "Quadrado", ovoide: "Ovoide",
  vertentes_paralelas: "Vertentes paralelas", afiladas: "Afiladas", retentivas: "Retentivas",
  alto: "Alto", medio: "Médio", baixo: "Baixo", reabsorvido: "Reabsorvido",
  fina: "Fina", espessa: "Espessa", hiperplasica: "Hiperplásica",

  // plano de tratamento
  placa_oclusal: "Placa oclusal", orientacoes_autocuidado: "Orientações de autocuidado", termoterapia: "Termoterapia",
  farmacoterapia: "Farmacoterapia", fisioterapia: "Fisioterapia", laser_baixa_intensidade: "Laser de baixa intensidade",
  exercicios_mandibulares: "Exercícios mandibulares", protese_total: "Prótese total",
  protese_parcial_removivel: "Prótese parcial removível", protese_fixa: "Prótese fixa",
  protese_sobre_implante: "Prótese sobre implante", encaminhamento: "Encaminhamento",

  // ficha de retorno
  total: "Total", parcial: "Parcial", nao_aderiu: "Não aderiu",

  // odontograma
  carie: "Cárie", restauracao: "Restauração", lesao_cervical_nao_cariosa: "Lesão cervical não cariosa", fratura: "Fratura",
  protese_preexistente: "Prótese pré-existente", coroa: "Coroa", implante: "Implante",
  tratamento_endodontico: "Tratamento endodôntico", recessao: "Recessão", atricao: "Atrição", abfracao: "Abfração", erosao: "Erosão",

  // paciente
  M: "Masculino", F: "Feminino",
};

/** Rótulo de exibição de um valor; valores sem rótulo aparecem com "_" trocado por espaço. */
export function rotulo(valor: unknown): string {
  if (valor === null || valor === undefined) return "—";
  if (typeof valor === "boolean") return valor ? "Sim" : "Não";
  const texto = String(valor);
  return ROTULOS[texto] ?? texto.replace(/_/g, " ");
}
