import express from 'express';
import sql from 'mssql';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

// Lazily build SQL Server connection configuration from env
function buildSqlConfig() {
  const rawServer = (process.env.SQL_SERVER_HOST || process.env.SQL_SERVER || '').trim();
  let serverHost = rawServer;
  let instanceName = (process.env.SQL_INSTANCE_NAME || '').trim();

  const backslashIndex = rawServer.indexOf('\\');
  if (backslashIndex !== -1) {
    serverHost = rawServer.slice(0, backslashIndex);
    if (!instanceName) {
      instanceName = rawServer.slice(backslashIndex + 1);
    }
  }

  if (!serverHost) {
    throw new Error('SQL_SERVER_HOST or SQL_SERVER is required');
  }

  const cfg = {
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    server: serverHost,
    database: process.env.SQL_DATABASE,
    domain: process.env.SQL_DOMAIN || undefined,
    options: {
      encrypt: false,
      trustServerCertificate: true,
      ...(instanceName ? { instanceName } : {}),
    },
  };

  return cfg;
}

router.get('/', (req, res) => {
  res.json({ message: 'AFE route is working!' });
});



router.get('/search-text', async (req, res) => {
  try {
    const sqlConfig = buildSqlConfig();
    await sql.connect(sqlConfig);

    const searchText = req.query.q;
    if (!searchText || searchText.trim().length === 0) {
      return res.status(400).json({ error: 'Search query parameter "q" is required' });
    }

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    // Search across AFE number, name, area, and creator names
    const query = `
      SELECT 
        c.Content_Guid,
        c.Name AS afe_number,
        ps_status.Value AS status,
        ps_type.Value AS type,
        ps_area.Value AS area,
        ps_name.Value AS name,
        ps_surface.Value AS surface_location,
        ps_gross.Value AS gross_budget,
        ps_net.Value AS net_budget,
        ps_wi_pct.Value AS working_interest_pct,
        CONCAT(creator_first.Value, ' ', creator_last.Value) AS created_by
      FROM tblContent c
      LEFT JOIN tblProperty_Strings ps_status ON ps_status.Content_Guid = c.Content_Guid 
        AND ps_status.Property_Guid = '2A13D0BA-6756-4E39-A7A9-828D52E603A8' -- afe_status_text
      LEFT JOIN tblProperty_Strings ps_type ON ps_type.Content_Guid = c.Content_Guid 
        AND ps_type.Property_Guid = '821378BD-083B-449D-814F-9CB3F8317B33' -- afe_type
      LEFT JOIN tblProperty_Strings ps_area ON ps_area.Content_Guid = c.Content_Guid 
        AND ps_area.Property_Guid = 'BEEC4906-50CD-47AA-B9AB-BA9ECD867C69' -- area
      LEFT JOIN tblProperty_Strings ps_name ON ps_name.Content_Guid = c.Content_Guid 
        AND ps_name.Property_Guid = 'C0B60CE9-8A89-4303-B699-C4C389095A30' -- name
      LEFT JOIN tblProperty_Strings ps_surface ON ps_surface.Content_Guid = c.Content_Guid 
        AND ps_surface.Property_Guid = '89EB0825-83C8-4E65-A674-D93DA2258EB6' -- surface_location
      LEFT JOIN tblProperty_Strings ps_gross ON ps_gross.Content_Guid = c.Content_Guid 
        AND ps_gross.Property_Guid = '031F3106-118D-440C-8487-4FCDDB6AE45A' -- gross_budget
      LEFT JOIN tblProperty_Strings ps_net ON ps_net.Content_Guid = c.Content_Guid 
        AND ps_net.Property_Guid = '11A4FF9F-A703-432E-9D41-67B6DB44F857' -- net_budget
      LEFT JOIN tblProperty_Strings ps_wi_pct ON ps_wi_pct.Content_Guid = c.Content_Guid 
        AND ps_wi_pct.Property_Guid = '6E3A4E36-4C74-4620-8B9B-C0A7B7754AB8' -- working_interest_pct
      -- Join to get creator's full name (first + last)
      LEFT JOIN tblProperty_Strings creator_first ON creator_first.Content_Guid = c.Publisher_User_Guid
        AND creator_first.Property_Guid = 'A52BB910-4798-4916-816F-CA895F78DD55' -- first_name
      LEFT JOIN tblProperty_Strings creator_last ON creator_last.Content_Guid = c.Publisher_User_Guid
        AND creator_last.Property_Guid = 'C15AEF9B-52D6-4052-8BF6-92F92B85A4DE' -- last_name
      WHERE c.Class_Guid IN (
        '55119960-A633-4AD8-810D-379049A25BE7',
        '1432A221-87A6-4C04-9CE9-5CE3DBB11125',
        'E6BF8767-C57B-4010-868C-B6FA0D99AAC9',
        '26B04FD9-8C60-4C21-A4A7-1EEE265C8D78',
        '1E50BFB1-2B93-4BCD-AB6B-27BC44D75E2A'
      )
      AND (
        c.Name LIKE @searchText
        OR ps_name.Value LIKE @searchText
        OR ps_area.Value LIKE @searchText
        OR creator_first.Value LIKE @searchText
        OR creator_last.Value LIKE @searchText
        OR CONCAT(creator_first.Value, ' ', creator_last.Value) LIKE @searchText
      )
      ORDER BY ps_created.Value DESC, c.Name DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `;

    const request = new sql.Request();
    request.input('searchText', sql.NVarChar, `%${searchText}%`);

    const { recordset } = await request.query(query);
    console.log(`AFE text search for "${searchText}" returned ${recordset.length} records`);

    // Format the response - only return table view fields
    const afes = recordset.map(row => ({
      afe_number: row.afe_number,
      status: row.status,
      type: row.type,
      area: row.area,
      name: row.name,
      surface_location: row.surface_location,
      gross_budget: row.gross_budget ? parseFloat(row.gross_budget) : null,
      net_budget: row.net_budget ? parseFloat(row.net_budget) : null,
      working_interest_pct: row.working_interest_pct ? parseFloat(row.working_interest_pct) : null
    }));

    res.json({
      afes,
      search_query: searchText,
      pagination: {
        limit,
        offset,
        count: recordset.length,
        has_more: recordset.length === limit
      }
    });

  } catch (err) {
    console.error('AFE text search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/list', async (req, res) => {
  try {
    const sqlConfig = buildSqlConfig();
    await sql.connect(sqlConfig);

    // Get query parameters for pagination and filtering
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const status = req.query.status; // optional status filter

    // Build the main query to get all AFEs with key fields
    let statusFilter = '';
    if (status) {
      statusFilter = `AND ps_status.Value = @status`;
    }

    const query = `
      SELECT 
        c.Content_Guid,
        c.Name AS afe_number,
        ps_status.Value AS status,
        ps_type.Value AS type,
        ps_area.Value AS area,
        ps_name.Value AS name,
        ps_surface.Value AS surface_location,
        ps_gross.Value AS gross_budget,
        ps_net.Value AS net_budget,
        ps_wi_pct.Value AS working_interest_pct,
        ps_approval.Value AS approval_status,
        ps_created.Value AS date_created,
        ps_company.Value AS company,
        CONCAT(creator_first.Value, ' ', creator_last.Value) AS created_by
      FROM tblContent c
      LEFT JOIN tblProperty_Strings ps_status ON ps_status.Content_Guid = c.Content_Guid 
        AND ps_status.Property_Guid = '2A13D0BA-6756-4E39-A7A9-828D52E603A8' -- afe_status_text
      LEFT JOIN tblProperty_Strings ps_type ON ps_type.Content_Guid = c.Content_Guid 
        AND ps_type.Property_Guid = '821378BD-083B-449D-814F-9CB3F8317B33' -- afe_type
      LEFT JOIN tblProperty_Strings ps_area ON ps_area.Content_Guid = c.Content_Guid 
        AND ps_area.Property_Guid = 'BEEC4906-50CD-47AA-B9AB-BA9ECD867C69' -- area
      LEFT JOIN tblProperty_Strings ps_name ON ps_name.Content_Guid = c.Content_Guid 
        AND ps_name.Property_Guid = 'C0B60CE9-8A89-4303-B699-C4C389095A30' -- name
      LEFT JOIN tblProperty_Strings ps_surface ON ps_surface.Content_Guid = c.Content_Guid 
        AND ps_surface.Property_Guid = '89EB0825-83C8-4E65-A674-D93DA2258EB6' -- surface_location
      LEFT JOIN tblProperty_Strings ps_gross ON ps_gross.Content_Guid = c.Content_Guid 
        AND ps_gross.Property_Guid = '031F3106-118D-440C-8487-4FCDDB6AE45A' -- gross_budget
      LEFT JOIN tblProperty_Strings ps_net ON ps_net.Content_Guid = c.Content_Guid 
        AND ps_net.Property_Guid = '11A4FF9F-A703-432E-9D41-67B6DB44F857' -- net_budget
      LEFT JOIN tblProperty_Strings ps_wi_pct ON ps_wi_pct.Content_Guid = c.Content_Guid 
        AND ps_wi_pct.Property_Guid = '6E3A4E36-4C74-4620-8B9B-C0A7B7754AB8' -- working_interest_pct
      LEFT JOIN tblProperty_Strings ps_approval ON ps_approval.Content_Guid = c.Content_Guid 
        AND ps_approval.Property_Guid = '8932EB93-DC6F-486F-A322-0E42FFB49CA0' -- approval_status
      LEFT JOIN tblProperty_Strings ps_created ON ps_created.Content_Guid = c.Content_Guid 
        AND ps_created.Property_Guid = 'EE38FF03-9C22-4DFB-89E4-8953BC2611E4' -- date_created
      LEFT JOIN tblProperty_Strings ps_company ON ps_company.Content_Guid = c.Content_Guid 
        AND ps_company.Property_Guid = '08575A2C-5B4A-4D1D-9459-003D6FCCDEDA' -- company
      -- Join to get creator's full name (first + last)
      LEFT JOIN tblProperty_Strings creator_first ON creator_first.Content_Guid = c.Publisher_User_Guid
        AND creator_first.Property_Guid = 'A52BB910-4798-4916-816F-CA895F78DD55' -- first_name
      LEFT JOIN tblProperty_Strings creator_last ON creator_last.Content_Guid = c.Publisher_User_Guid
        AND creator_last.Property_Guid = 'C15AEF9B-52D6-4052-8BF6-92F92B85A4DE' -- last_name
      WHERE c.Class_Guid IN (
        '55119960-A633-4AD8-810D-379049A25BE7',
        '1432A221-87A6-4C04-9CE9-5CE3DBB11125',
        'E6BF8767-C57B-4010-868C-B6FA0D99AAC9',
        '26B04FD9-8C60-4C21-A4A7-1EEE265C8D78',
        '1E50BFB1-2B93-4BCD-AB6B-27BC44D75E2A'
      )
      ${statusFilter}
      ORDER BY ps_created.Value DESC, c.Name DESC
      OFFSET ${offset} ROWS
      FETCH NEXT ${limit} ROWS ONLY
    `;

    const request = new sql.Request();
    if (status) {
      request.input('status', sql.NVarChar, status);
    }

    const { recordset } = await request.query(query);
    console.log(`AFE list query returned ${recordset.length} records`);

    // Format the response - only return table view fields
    const afes = recordset.map(row => ({
      afe_number: row.afe_number,
      status: row.status,
      type: row.type,
      area: row.area,
      name: row.name,
      surface_location: row.surface_location,
      gross_budget: row.gross_budget ? parseFloat(row.gross_budget) : null,
      net_budget: row.net_budget ? parseFloat(row.net_budget) : null,
      working_interest_pct: row.working_interest_pct ? parseFloat(row.working_interest_pct) : null
    }));

    res.json({
      afes,
      pagination: {
        limit,
        offset,
        count: recordset.length,
        has_more: recordset.length === limit
      }
    });

  } catch (err) {
    console.error('AFE list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/search', async (req, res) => {
  const { afeNumbers } = req.body;
  if (!Array.isArray(afeNumbers) || afeNumbers.length === 0)
    return res.status(400).json({ error: 'afeNumbers array required' });

  try {
    const sqlConfig = buildSqlConfig();
    await sql.connect(sqlConfig);

    // Search for the main AFE record across all the main Class_Guids
    const clauses = afeNumbers.map((_, i) => `c.Name = @n${i}`).join(' OR ');
    const query = `
      SELECT 
        c.Content_Guid,
        c.Name            AS afe_number,
        c.Class_Guid,
        ps.Property_Guid,
        ps.Value          AS field_value
      FROM tblContent c
      LEFT JOIN tblProperty_Strings ps
        ON ps.Content_Guid = c.Content_Guid
      WHERE c.Class_Guid IN (
        '55119960-A633-4AD8-810D-379049A25BE7',
        '1432A221-87A6-4C04-9CE9-5CE3DBB11125',
        'E6BF8767-C57B-4010-868C-B6FA0D99AAC9',
        '26B04FD9-8C60-4C21-A4A7-1EEE265C8D78',
        '1E50BFB1-2B93-4BCD-AB6B-27BC44D75E2A'
      )
        AND (${clauses})
    `;

    const request = new sql.Request();
    afeNumbers.forEach((num, i) => {
      request.input(`n${i}`, sql.NVarChar, num);
    });

    const { recordset } = await request.query(query);

    // Comprehensive property mapping for all AFE fields
    const propertyMap = {
      // Identifiers
      '18923387-E8BA-45E7-AE7F-ABEA2C7C0E62': 'afe_number_full',
      'B752F427-C4D7-4E86-94BA-67346D790D5F': 'afe_number_base',

      // Header fields (Details)
      '08575A2C-5B4A-4D1D-9459-003D6FCCDEDA': 'company',
      'C0B60CE9-8A89-4303-B699-C4C389095A30': 'name',
      '821378BD-083B-449D-814F-9CB3F8317B33': 'afe_type',
      '419B8872-E9C9-4EBE-8BCB-58783F5DE96A': 'is_preliminary',
      'C55E4ED1-41FB-42F5-968A-D0C9195D3897': 'operator',
      '157B539D-0BD4-4E82-A032-EECCB0181A45': 'province',
      'BEEC4906-50CD-47AA-B9AB-BA9ECD867C69': 'area',
      '38C19027-7E69-45DE-901E-85091DF9AD35': 'expenditure_line',
      '89EB0825-83C8-4E65-A674-D93DA2258EB6': 'surface_location', // often filled on supplements
      '52E32478-CD61-4E71-ABEA-870BADB108D7': 'cost_center',
      'A986BA3D-6266-48DF-8D96-7DAA539A8104': 'managing_org',
      '06B6DE12-1573-4A5C-810C-402C1A686631': 'managing_org_id',
      'C35A8269-3EBD-43CE-8E5D-C3A862441587': 'qbyte_reference',
      '4DF2C006-C3D8-4D23-B235-96A46D80B85D': 'project_name',
      'ED52424F-C301-43F9-A991-C05E4944D101': 'justification',

      // Key Dates
      '8D02DA53-DABF-4D28-8D0B-4E9F62D8D5AD': 'fiscal_year',
      'EE38FF03-9C22-4DFB-89E4-8953BC2611E4': 'date_created',
      'B65AC416-49C1-4ED8-8A8D-F7310D208AD7': 'estimated_start',
      '27139ECE-4EF2-4402-ABEB-6E29357B769D': 'estimated_completion',
      'AD9D3606-E1E9-44A2-887F-A79B0141019F': 'submitted_for_approval',

      // Totals
      '6E3A4E36-4C74-4620-8B9B-C0A7B7754AB8': 'working_interest_pct',
      'C1102A35-AC8F-4AF1-A21B-BF2D6E782CF9': 'working_interest_ratio',
      '031F3106-118D-440C-8487-4FCDDB6AE45A': 'gross_budget',
      '11A4FF9F-A703-432E-9D41-67B6DB44F857': 'net_budget',
      '80434A42-7530-411E-BD67-78D3B49A5A5B': 'total_gross',
      '51A1C179-9C32-4C71-A298-BC4633EA941C': 'total_net',

      // Workflow/approval
      '8932EB93-DC6F-486F-A322-0E42FFB49CA0': 'approval_status',
      '2A13D0BA-6756-4E39-A7A9-828D52E603A8': 'afe_status_text',   // e.g., Transferred
      'F125D2FB-66F3-4405-BA23-54FA800AD3D9': 'afe_status_lock',

      // Additional percentages
      '7B20F627-EB8C-4CFA-97BA-9CAFA4402F7F': 'bpo_percent',              // 100
      'D61790B1-3FF0-4824-A280-B0A53C5BB5EE': 'apo_percent',              // 100

      // Additional fields from AFE detail view
      '088F82A7-A7A7-43CC-A123-572C30271F37': 'originator',              // Chris Billinger
      '1A15F1F7-9312-4ADE-89AB-6BA428ABF36D': 'originator_name',         // Chris Billinger (duplicate?)
      'DE3D08EE-6990-41C2-A8F6-A932491360C3': 'operator_afe_number',     // 101506
      '064A103F-131D-4ED8-AA1C-F8D3D94676DC': 'province_code',           // AB
      '53619C9B-1ED7-4F25-8058-10F686EC9E06': 'afe_supplement_type',     // SUPPLEMENT
      '4B1E9761-B506-4CF9-883C-2E8A05CF41DC': 'afe_supplement_id',       // AFE_1220030153SUPPLEMENT
      '55B8021F-2DF6-4532-AE96-47FDC0AF1C09': 'percentage_100',          // 100 (likely working interest)
      '5ABE7EB2-3EB5-4687-B02A-48C7D3C02EF8': 'amount_100000',           // 100000 (budget amount)
      'A67E05AC-2850-4F23-ADD2-488CE4968060': 'is_active_flag',          // True
      'FBBA6BA8-F07D-4DD8-A3E9-71A7FE60C1E9': 'boolean_flag_1',          // False
      '37C821E4-3378-407A-B4FD-851B50CBEAF7': 'boolean_flag_2',          // False
      'D94B9621-9E3C-4082-8C50-68090E2B795E': 'boolean_flag_3',          // False
      '636149C1-0C4E-42A2-B6E2-FCE402F0A151': 'boolean_flag_4',          // True
      'E97E642D-E110-4C6C-A54A-F268E2C2D373': 'boolean_flag_5',          // False
      '4B85D2F4-E3C3-4821-A3D6-FFB95A97AF01': 'percentage_field',        // 100
      '7E4A247D-FC0F-4B83-99BA-9E954361FD1E': 'linked_content_guid',     // Reference to another content
      '52C9B580-91BE-4DA3-95BB-7A65C1995CF5': 'linked_guid_2',           // Another GUID reference
      '28AAD120-7E14-46D4-9BEE-8D3494EC01E3': 'sequence_number',         // 1
      'E3223C16-759F-400C-9008-109CD1FD4298': 'zero_value',              // 0
      'D502D598-7891-4C24-B6F2-37BF500BA05F': 'zero_value_2'             // 0
    };

    // Group by Content_Guid and map properties to field names
    const afeMap = {};
    for (const row of recordset) {
      const { Content_Guid: id, afe_number, Property_Guid: pg, field_value } = row;
      if (!afeMap[id]) {
        afeMap[id] = {
          afe_number,
          // Identifiers
          afe_number_full: null,
          afe_number_base: null,
          // Header fields
          company: null,
          name: null,
          afe_type: null,
          is_preliminary: null,
          operator: null,
          province: null,
          area: null,
          expenditure_line: null,
          surface_location: null,
          cost_center: null,
          managing_org: null,
          managing_org_id: null,
          qbyte_reference: null,
          project_name: null,
          justification: null,
          // Key Dates
          fiscal_year: null,
          date_created: null,
          estimated_start: null,
          estimated_completion: null,
          submitted_for_approval: null,
          // Totals
          working_interest_pct: null,
          working_interest_ratio: null,
          gross_budget: null,
          net_budget: null,
          total_gross: null,
          total_net: null,
          // Workflow/approval
          approval_status: null,
          afe_status_text: null,
          afe_status_lock: null,
          // Additional percentages
          bpo_percent: null,
          apo_percent: null,
          // Additional fields from AFE detail view
          originator: null,
          originator_name: null,
          operator_afe_number: null,
          province_code: null,
          afe_supplement_type: null,
          afe_supplement_id: null,
          percentage_100: null,
          amount_100000: null,
          is_active_flag: null,
          boolean_flag_1: null,
          boolean_flag_2: null,
          boolean_flag_3: null,
          boolean_flag_4: null,
          boolean_flag_5: null,
          percentage_field: null,
          linked_content_guid: null,
          linked_guid_2: null,
          sequence_number: null,
          zero_value: null,
          zero_value_2: null,
        };
      }
      const fieldName = propertyMap[pg];
      if (fieldName && field_value !== null) {
        afeMap[id][fieldName] = field_value;
      }
    }

    res.json(Object.values(afeMap));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal error' });
  }
});

export default router;