import { XMLParser } from 'fast-xml-parser';
import { SapMetadata, SapEntitySet, SapField } from '@/types/sap';

export class MetadataParser {
  /**
   * Parse an OData $metadata EDMX XML string into a structured SapMetadata object.
   */
  public static parse(xmlContent: string): SapMetadata {
    if (!xmlContent || typeof xmlContent !== 'string') {
      throw new Error('Empty or invalid XML content provided for metadata parsing');
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true, // Strips 'edmx:', 'm:', 'sap:' from element tags for consistent traversal
      allowBooleanAttributes: true,
      parseAttributeValue: false, // Keep as raw string for fidelity
      trimValues: true,
    });

    let jsonObj: any;
    try {
      jsonObj = parser.parse(xmlContent);
    } catch (err: any) {
      throw new Error(`XML parsing failed: ${err.message}`);
    }

    // Traverse to DataServices and Schema
    const edmx = jsonObj.Edmx || jsonObj;
    const dataServices = edmx.DataServices;
    if (!dataServices) {
      throw new Error('Invalid EDMX structure: Missing DataServices element');
    }

    // Determine OData version
    const versionAttr = edmx['@_Version'] || '';
    const odataVersion: '2.0' | '4.0' = versionAttr.startsWith('4') ? '4.0' : '2.0';

    // Schemas may be an array or single object
    const rawSchemas = dataServices.Schema;
    const schemas: any[] = Array.isArray(rawSchemas) ? rawSchemas : rawSchemas ? [rawSchemas] : [];

    if (schemas.length === 0) {
      throw new Error('No Schema definitions found in OData $metadata');
    }

    let primaryNamespace = '';
    const entityTypesMap = new Map<string, { keyFields: string[]; properties: SapField[] }>();
    const entitySetsList: SapEntitySet[] = [];

    // 1. First pass: Collect all EntityTypes across all schemas
    for (const schema of schemas) {
      const namespace = schema['@_Namespace'] || '';
      if (!primaryNamespace && namespace) {
        primaryNamespace = namespace;
      }

      const rawEntityTypes = schema.EntityType;
      const entityTypes: any[] = Array.isArray(rawEntityTypes)
        ? rawEntityTypes
        : rawEntityTypes
        ? [rawEntityTypes]
        : [];

      for (const et of entityTypes) {
        const etName = et['@_Name'] || '';
        if (!etName) continue;

        // Keys
        const keyFields: string[] = [];
        if (et.Key && et.Key.PropertyRef) {
          const rawRefs = et.Key.PropertyRef;
          const refs: any[] = Array.isArray(rawRefs) ? rawRefs : [rawRefs];
          for (const ref of refs) {
            const propRefName = ref['@_Name'];
            if (propRefName) keyFields.push(propRefName);
          }
        }

        // Properties
        const properties: SapField[] = [];
        const rawProps = et.Property;
        const propList: any[] = Array.isArray(rawProps) ? rawProps : rawProps ? [rawProps] : [];

        for (const p of propList) {
          const propName = p['@_Name'] || '';
          if (!propName) continue;

          const propType = p['@_Type'] || 'Edm.String';
          const nullable = p['@_Nullable'] !== 'false';
          const isKey = keyFields.includes(propName);
          const label =
            p['@_sap:label'] ||
            p['@_label'] ||
            p['@_SapLabel'] ||
            p['@_heading'] ||
            propName;

          const maxLengthStr = p['@_MaxLength'];
          const maxLength = maxLengthStr && !isNaN(Number(maxLengthStr)) ? Number(maxLengthStr) : undefined;

          const precisionStr = p['@_Precision'];
          const precision = precisionStr && !isNaN(Number(precisionStr)) ? Number(precisionStr) : undefined;

          const scaleStr = p['@_Scale'];
          const scale = scaleStr && !isNaN(Number(scaleStr)) ? Number(scaleStr) : undefined;

          properties.push({
            name: propName,
            label,
            type: propType,
            nullable,
            isKey,
            maxLength,
            precision,
            scale,
          });
        }

        // Store by simple name and qualified namespace.name
        entityTypesMap.set(etName, { keyFields, properties });
        if (namespace) {
          entityTypesMap.set(`${namespace}.${etName}`, { keyFields, properties });
        }
      }
    }

    // 2. Second pass: Collect all EntitySets from EntityContainer
    for (const schema of schemas) {
      const rawContainers = schema.EntityContainer;
      const containers: any[] = Array.isArray(rawContainers)
        ? rawContainers
        : rawContainers
        ? [rawContainers]
        : [];

      for (const container of containers) {
        const rawSets = container.EntitySet;
        const setList: any[] = Array.isArray(rawSets) ? rawSets : rawSets ? [rawSets] : [];

        for (const set of setList) {
          const setName = set['@_Name'] || '';
          if (!setName) continue;

          const rawEntityType = set['@_EntityType'] || '';
          // Resolve entity type definition
          let etDef = entityTypesMap.get(rawEntityType);
          if (!etDef) {
            // Strip namespace if qualified (e.g., 'API_PURCHASEORDER_PROCESS_SRV.A_PurchaseOrderType' -> 'A_PurchaseOrderType')
            const simpleName = rawEntityType.includes('.')
              ? rawEntityType.split('.').pop() || rawEntityType
              : rawEntityType;
            etDef = entityTypesMap.get(simpleName);
          }

          const fields = etDef ? etDef.properties : [];
          const keyFields = etDef ? etDef.keyFields : [];

          const creatable = set['@_sap:creatable'] !== 'false';
          const updatable = set['@_sap:updatable'] !== 'false';
          const deletable = set['@_sap:deletable'] !== 'false';

          entitySetsList.push({
            name: setName,
            entityType: rawEntityType,
            creatable,
            updatable,
            deletable,
            fields,
            keyFields,
          });
        }
      }
    }

    // Fallback: If no EntitySets found in containers, use the EntityTypes as fallback sets
    if (entitySetsList.length === 0 && entityTypesMap.size > 0) {
      for (const [name, def] of entityTypesMap.entries()) {
        if (!name.includes('.')) {
          entitySetsList.push({
            name,
            entityType: name,
            creatable: true,
            updatable: true,
            deletable: true,
            fields: def.properties,
            keyFields: def.keyFields,
          });
        }
      }
    }

    return {
      version: odataVersion,
      namespace: primaryNamespace || 'SAP_ODATA',
      entitySets: entitySetsList,
      fetchedAt: new Date().toISOString(),
    };
  }
}
