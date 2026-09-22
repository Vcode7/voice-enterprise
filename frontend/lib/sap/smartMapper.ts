import { TemplateField } from '@/types';
import {
  SapField,
  SapFieldMappingRule,
  SapFieldTransform,
} from '@/types/sap';

interface SemanticCluster {
  voiceTerms: string[];
  sapTerms: string[];
}

const SEMANTIC_CLUSTERS: Record<string, SemanticCluster> = {
  material: {
    voiceTerms: ['material', 'part_no', 'part_number', 'item_code', 'product_id', 'component', 'f_part_no'],
    sapTerms: ['material', 'matnr', 'partno', 'product', 'itemcode', 'materialnumber'],
  },
  material_desc: {
    voiceTerms: ['part_name', 'description', 'material_name', 'item_name', 'product_name', 'f_part_name'],
    sapTerms: ['materialdescription', 'purchaseorderitemtext', 'itemtext', 'description', 'maktx'],
  },
  quantity: {
    voiceTerms: ['quantity', 'qty', 'produced_qty', 'count', 'amount_units', 'total_qty', 'f_qty', 'tf_qty'],
    sapTerms: ['orderquantity', 'confirmedquantity', 'quantity', 'menge', 'targetquantity', 'actualquantity'],
  },
  scrap: {
    voiceTerms: ['scrap', 'rejection', 'rejected_qty', 'damaged', 'defect_qty', 'tf_rejection'],
    sapTerms: ['scrapquantity', 'rejectedquantity', 'scrap', 'rejectionquantity'],
  },
  plant: {
    voiceTerms: ['plant', 'facility', 'branch', 'location', 'site', 'f_plant', 'factory'],
    sapTerms: ['plant', 'werks', 'productionplant', 'receivingplant'],
  },
  storage_location: {
    voiceTerms: ['storage_location', 'warehouse', 'loc', 'godown', 'bin', 'f_storage_loc'],
    sapTerms: ['storagelocation', 'lgort', 'storage_loc'],
  },
  batch: {
    voiceTerms: ['batch', 'batch_no', 'lot', 'lot_number', 'f_batch_no', 'heat_no'],
    sapTerms: ['batch', 'charg', 'lotnumber', 'batchnumber'],
  },
  operator: {
    voiceTerms: ['operator', 'operator_name', 'personnel', 'employee', 'worker', 'inspector', 'f_operator'],
    sapTerms: ['personnelnumber', 'operator', 'pernr', 'employeeid', 'confirmedby'],
  },
  shift: {
    voiceTerms: ['shift', 'work_shift', 'working_shift', 'f_shift'],
    sapTerms: ['workshift', 'shift', 'shifttype', 'workingshift'],
  },
  machine: {
    voiceTerms: ['machine', 'machine_no', 'equipment', 'press_no', 'work_center', 'f_machine_name'],
    sapTerms: ['equipment', 'workcenter', 'machine', 'arbpl', 'machinenumber'],
  },
  date: {
    voiceTerms: ['date', 'entry_date', 'production_date', 'doc_date', 'posting_date'],
    sapTerms: ['confirmationdate', 'purchaseorderdate', 'documentdate', 'postingdate', 'createdon', 'bldat', 'budat'],
  },
  counter_open: {
    voiceTerms: ['opening_counter', 'start_counter', 'initial_counter', 'counter_start'],
    sapTerms: ['openingcounter', 'startcounter', 'initialcounter'],
  },
  counter_close: {
    voiceTerms: ['closing_counter', 'end_counter', 'final_counter', 'counter_end'],
    sapTerms: ['closingcounter', 'endcounter', 'finalcounter'],
  },
  purge_weight: {
    voiceTerms: ['purge_weight', 'purge', 'purge_waste', 'f_purge_weight'],
    sapTerms: ['purgeweight', 'purgeqty'],
  },
  runner_weight: {
    voiceTerms: ['runner_weight', 'runner', 'runner_scrap', 'f_runner_weight'],
    sapTerms: ['runnerweight', 'runnerqty'],
  },
  cavities: {
    voiceTerms: ['no_of_cavities', 'cavities', 'f_no_of_cavities'],
    sapTerms: ['cavitiescount', 'noofcavities', 'cavities'],
  },
  remarks: {
    voiceTerms: ['remarks', 'notes', 'comments', 'tf_remarks', 'summary'],
    sapTerms: ['remarks', 'materialdocumentheadertext', 'itemtext', 'headernote', 'comment'],
  },
  purchase_order: {
    voiceTerms: ['po', 'po_number', 'purchase_order', 'order_no'],
    sapTerms: ['purchaseorder', 'ebeln', 'purchasingdocument'],
  },
  supplier: {
    voiceTerms: ['supplier', 'vendor', 'merchant'],
    sapTerms: ['supplier', 'vendor', 'lifnr'],
  },
};

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/^(f_|tf_|f\d+_|tf\d+_)/, '')
    .replace(/[_\-\s\(\)\/]/g, '')
    .trim();
}

function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

function calculateSimilarity(s1: string, s2: string): number {
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;
  const dist = levenshteinDistance(s1, s2);
  return 1.0 - dist / maxLen;
}

export class SmartMapper {
  /**
   * Suggest field mappings between a Voice Entry Template and an SAP Entity Set.
   */
  public static suggestMappings(
    templateFields: TemplateField[],
    sapFields: SapField[]
  ): SapFieldMappingRule[] {
    const rules: SapFieldMappingRule[] = [];
    const usedSapFields = new Set<string>();

    for (const tf of templateFields) {
      const normVoiceKey = normalizeString(tf.extractionKey);
      const normVoiceName = normalizeString(tf.name);

      let bestSapField: SapField | null = null;
      let highestScore = 0;

      for (const sf of sapFields) {
        if (usedSapFields.has(sf.name)) continue;

        const normSapName = normalizeString(sf.name);
        const normSapLabel = sf.label ? normalizeString(sf.label) : '';

        // 1. Exact match on normalized string (score: 1.0)
        if (normVoiceKey === normSapName || normVoiceName === normSapName) {
          bestSapField = sf;
          highestScore = 1.0;
          break;
        }

        // 2. Semantic Cluster match (score: 0.9)
        let clusterMatch = false;
        for (const cluster of Object.values(SEMANTIC_CLUSTERS)) {
          const matchesVoice = cluster.voiceTerms.some(
            (term) => normalizeString(term) === normVoiceKey || normalizeString(term) === normVoiceName
          );
          const matchesSap = cluster.sapTerms.some(
            (term) => normalizeString(term) === normSapName || (normSapLabel && normalizeString(term) === normSapLabel)
          );

          if (matchesVoice && matchesSap) {
            clusterMatch = true;
            break;
          }
        }

        if (clusterMatch && highestScore < 0.9) {
          bestSapField = sf;
          highestScore = 0.9;
          continue;
        }

        // 3. Substring inclusion match (score: 0.75)
        if (
          (normSapName.includes(normVoiceKey) || normVoiceKey.includes(normSapName)) &&
          highestScore < 0.75
        ) {
          bestSapField = sf;
          highestScore = 0.75;
          continue;
        }

        // 4. Fuzzy Levenshtein match (threshold: >= 0.7)
        const nameSim = calculateSimilarity(normVoiceKey, normSapName);
        const labelSim = normSapLabel ? calculateSimilarity(normVoiceName, normSapLabel) : 0;
        const fuzzyScore = Math.max(nameSim, labelSim);

        if (fuzzyScore >= 0.7 && fuzzyScore > highestScore) {
          bestSapField = sf;
          highestScore = fuzzyScore;
        }
      }

      if (bestSapField && highestScore >= 0.7) {
        usedSapFields.add(bestSapField.name);

        let defaultTransform: SapFieldTransform = 'none';
        if (bestSapField.type === 'Edm.DateTime' || bestSapField.type === 'Edm.DateTimeOffset') {
          defaultTransform = 'date_iso';
        } else if (bestSapField.type === 'Edm.Decimal' || bestSapField.type === 'Edm.Int32') {
          defaultTransform = 'number';
        }

        rules.push({
          templateFieldKey: tf.extractionKey,
          templateFieldName: tf.name,
          templateFieldType: tf.type,
          sapFieldName: bestSapField.name,
          sapFieldType: bestSapField.type,
          isKey: bestSapField.isKey,
          isRequired: !bestSapField.nullable,
          defaultValue: tf.defaultValue || '',
          transformation: defaultTransform,
        });
      } else {
        // Unmapped placeholder
        rules.push({
          templateFieldKey: tf.extractionKey,
          templateFieldName: tf.name,
          templateFieldType: tf.type,
          sapFieldName: '', // None selected
          sapFieldType: '',
          isKey: false,
          isRequired: false,
          defaultValue: tf.defaultValue || '',
          transformation: 'none',
        });
      }
    }

    return rules;
  }

  /**
   * Validate compatibility between a template field type and an SAP field type.
   */
  public static validateCompatibility(
    templateType: string,
    sapType: string
  ): { status: 'compatible' | 'warning' | 'incompatible'; message: string } {
    if (!sapType) {
      return { status: 'warning', message: 'Field is currently unmapped.' };
    }

    const sType = sapType.toLowerCase();
    const tType = templateType.toLowerCase();

    // Text to string
    if (tType === 'text' || tType === 'select') {
      if (sType.includes('string')) return { status: 'compatible', message: 'Compatible types.' };
      if (sType.includes('int') || sType.includes('decimal') || sType.includes('double')) {
        return {
          status: 'warning',
          message: 'Voice field is text; ensure voice input always contains valid numeric characters.',
        };
      }
      if (sType.includes('datetime')) {
        return {
          status: 'warning',
          message: 'Voice field is text; ensure values parse to a valid date.',
        };
      }
      if (sType.includes('boolean')) {
        return {
          status: 'warning',
          message: 'Voice field is text; will be converted to boolean (true/false).',
        };
      }
    }

    // Number to numeric
    if (tType === 'number') {
      if (
        sType.includes('int') ||
        sType.includes('decimal') ||
        sType.includes('double') ||
        sType.includes('single') ||
        sType.includes('byte')
      ) {
        return { status: 'compatible', message: 'Compatible numeric types.' };
      }
      if (sType.includes('string')) {
        return { status: 'compatible', message: 'Number will be converted to string for SAP.' };
      }
      return {
        status: 'incompatible',
        message: `Incompatible mapping: Number cannot be assigned to ${sapType}.`,
      };
    }

    // Date to date
    if (tType === 'date') {
      if (sType.includes('datetime') || sType.includes('date')) {
        return { status: 'compatible', message: 'Compatible date formats.' };
      }
      if (sType.includes('string')) {
        return { status: 'compatible', message: 'Date will be formatted as standard ISO string.' };
      }
      return {
        status: 'incompatible',
        message: `Incompatible mapping: Date cannot be assigned to ${sapType}.`,
      };
    }

    // Boolean to boolean
    if (tType === 'boolean') {
      if (sType.includes('boolean')) return { status: 'compatible', message: 'Compatible boolean types.' };
      if (sType.includes('string')) return { status: 'compatible', message: 'Boolean converted to "X" / "" or true/false.' };
    }

    return { status: 'compatible', message: 'Types are compatible.' };
  }
}
