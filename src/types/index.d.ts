type RawRow = { [key: string]: any };

type TicketRow = {
  n: number | string;
  num_pat?: string;
  civ?: string;
  placa?: string;
  num_serie?: string;
  marca?: string;
  tipo?: string;
  mod?: string;
  fecha?: any;
  num_folio?: any;
  odometro?: any;
  importe?: any;
  combustible?: string;
  chofer?: string;
  recorrido?: string;
  observacion?: string;
  folio?: string;
  folio_fiscal?: string;
};

type GroupedData = Record<string, TicketRow[]>;
