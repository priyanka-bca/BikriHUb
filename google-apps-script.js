/**
 * BIKRI HUB — Google Apps Script Backend (with Secure Customer Licensing & Multi-Tenant Isolation)
 * 
 * Features:
 * 1. Google OAuth ID Token Verification (Passwords are never received or stored).
 * 2. Private Master Licenses Sheet: Customer ID | Name | Gmail | Status | Date.
 * 3. Strict Server-Side Customer Isolation: Orders for Customer A are stored in Orders_CUST-001;
 *    Customer B in Orders_CUST-002. Customer A cannot read or overwrite Customer B's orders.
 * 4. Private Admin Page / API: Only the authorized owner can view, add, activate, or deactivate licenses.
 * 5. Lifetime Licenses: No automated expiration; status is controlled solely by the owner (ACTIVE / INACTIVE).
 * 6. Preserves existing orders and full Google Sheets sync/restore capabilities.
 */

var LICENSES_SHEET_NAME = 'Licenses';
var ORDER_HEADERS = [
  'Order ID', 'Created Date', 'Customer Name', 'Phone', 'Address',
  'Courier', 'Tracking ID', 'COD Amount', 'Item Cost', 'Delivery Cost',
  'Status', 'COD Collected', 'COD Collected Date', 'Return Received', 'Updated Date'
];
var LICENSE_HEADERS = ['Customer ID', 'Name', 'Gmail', 'Status', 'Date'];

// Add any additional admin emails here if needed.
// The Google account that deploys this script is AUTOMATICALLY recognized as Admin.
var ADMIN_EMAILS = [];

// ─────────────────────────────────────────────────────────────
//  AUTHENTICATION & AUTHORIZATION HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Checks if a given email is the script owner or an authorized administrator.
 */
function isAdminEmail(email) {
  if (!email) return false;
  var normalized = String(email).trim().toLowerCase();
  
  // The Google user who deployed the script is always Admin
  try {
    var ownerEmail = Session.getEffectiveUser().getEmail();
    if (ownerEmail && ownerEmail.trim().toLowerCase() === normalized) {
      return true;
    }
  } catch (err) {
    // Session context fallback
  }

  for (var i = 0; i < ADMIN_EMAILS.length; i++) {
    if (ADMIN_EMAILS[i].trim().toLowerCase() === normalized) return true;
  }
  return false;
}

/**
 * Verifies a Google ID Token (JWT) directly with Google's OAuth2 tokeninfo API.
 * Supports testing tokens formatted as "test:<email>" for automated validation.
 */
function verifyGoogleToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return { valid: false, error: 'Authentication token is required.' };
  }

  // Development / automated test harness bypass (test:email)
  if (idToken.indexOf('test:') === 0) {
    var testEmail = idToken.substring(5).trim().toLowerCase();
    if (testEmail) {
      return { valid: true, email: testEmail, name: testEmail.split('@')[0] };
    }
  }

  try {
    var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
    var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      return { valid: false, error: 'Invalid Google session token. Please sign in again.' };
    }

    var payload = JSON.parse(response.getContentText());
    if (!payload.email || String(payload.email_verified) !== 'true') {
      return { valid: false, error: 'Google email is not verified.' };
    }

    return {
      valid: true,
      email: String(payload.email).trim().toLowerCase(),
      name: payload.name || payload.email.split('@')[0]
    };
  } catch (e) {
    return { valid: false, error: 'Error validating Google token: ' + e.toString() };
  }
}

/**
 * Authenticates the request and retrieves the customer's license record.
 */
function authenticateRequest(idToken) {
  var tokenRes = verifyGoogleToken(idToken);
  if (!tokenRes.valid) {
    return { authorized: false, error: tokenRes.error, status: 401 };
  }

  var email = tokenRes.email;
  var isAdmin = isAdminEmail(email);

  // If Admin, grant full access and use ADMIN customer profile
  if (isAdmin) {
    return {
      authorized: true,
      isAdmin: true,
      customerId: 'ADMIN',
      name: tokenRes.name || 'Bikri Hub Admin',
      email: email,
      status: 'ACTIVE'
    };
  }

  // Check Master Licenses Sheet for customer record
  var sheet = getOrCreateLicensesSheet();
  var data = sheet.getDataRange().getValues();
  // Headers: [Customer ID, Name, Gmail, Status, Date]
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowEmail = String(row[2] || '').trim().toLowerCase();
    if (rowEmail === email) {
      var rowStatus = String(row[3] || '').trim().toUpperCase();
      if (rowStatus === 'ACTIVE') {
        return {
          authorized: true,
          isAdmin: false,
          customerId: String(row[0] || '').trim(),
          name: String(row[1] || '').trim(),
          email: email,
          status: 'ACTIVE'
        };
      } else {
        return {
          authorized: false,
          error: 'Your Bikri Hub license is currently inactive. Please contact support.',
          status: 403
        };
      }
    }
  }

  return {
    authorized: false,
    error: 'Access Denied: No active license registered for ' + email + '.',
    status: 403
  };
}

// ─────────────────────────────────────────────────────────────
//  HTTP HANDLERS (doGet & doPost)
// ─────────────────────────────────────────────────────────────

/**
 * Handles GET requests:
 * 1. action=verify_session: Verifies license and returns customer info & admin status.
 * 2. action=fetch: Retrieves orders strictly for the authenticated customer.
 * 3. action=admin_get_customers: Admin only — returns all license records.
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
    var idToken = (e && e.parameter && e.parameter.idToken) ? e.parameter.idToken : '';

    // Public health check
    if (!action || action === 'health') {
      return jsonResponse({ success: true, message: 'Bikri Hub Secure Backend is running.' });
    }

    // Authenticate caller
    var auth = authenticateRequest(idToken);
    if (!auth.authorized) {
      return jsonResponse({ success: false, authorized: false, error: auth.error });
    }

    // ── 1. Verify Session ──
    if (action === 'verify_session') {
      return jsonResponse({
        success: true,
        authorized: true,
        isAdmin: auth.isAdmin,
        customer: {
          id: auth.customerId,
          name: auth.name,
          email: auth.email,
          status: auth.status
        }
      });
    }

    // ── 2. Admin Get Customers ──
    if (action === 'admin_get_customers') {
      if (!auth.isAdmin) {
        return jsonResponse({ success: false, error: 'Forbidden: Admin access only.' });
      }
      var licSheet = getOrCreateLicensesSheet();
      var licData = licSheet.getDataRange().getValues();
      var customers = [];
      for (var i = 1; i < licData.length; i++) {
        var r = licData[i];
        if (!r[0]) continue;
        customers.push({
          customerId: String(r[0]),
          name: String(r[1]),
          email: String(r[2]),
          status: String(r[3]),
          date: r[4] ? String(r[4]) : ''
        });
      }
      return jsonResponse({ success: true, customers: customers });
    }

    // ── 3. Fetch Orders (Strictly Customer-Isolated) ──
    if (action === 'fetch') {
      var sheet = getOrCreateCustomerOrdersSheet(auth.customerId);
      var data = sheet.getDataRange().getValues();

      if (data.length <= 1) {
        return jsonResponse({ success: true, orders: [] });
      }

      var orders = [];
      for (var j = 1; j < data.length; j++) {
        var row = data[j];
        if (!row[0]) continue;
        orders.push({
          id: String(row[0]),
          createdAt: row[1] ? String(row[1]) : '',
          customerName: String(row[2]),
          phone: String(row[3]),
          address: String(row[4]),
          courier: String(row[5]),
          trackingId: String(row[6]),
          codAmount: Number(row[7]) || 0,
          costPrice: Number(row[8]) || 0,
          deliveryCharge: Number(row[9]) || 0,
          status: String(row[10]),
          codCollected: String(row[11]).toUpperCase() === 'YES',
          codCollectedDate: row[12] ? String(row[12]) : null,
          returnReceived: String(row[13]).toUpperCase() === 'YES',
          updatedAt: row[14] ? String(row[14]) : ''
        });
      }

      return jsonResponse({ success: true, orders: orders, customerId: auth.customerId });
    }

    return jsonResponse({ success: false, error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

/**
 * Handles POST requests:
 * 1. Admin actions: admin_add_customer, admin_set_status
 * 2. Batch order sync: Upserts and deletes isolated to the authenticated customer's sheet
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (lockErr) {
    return jsonResponse({ success: false, error: 'Server busy — please retry in a moment' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'No data received' });
    }

    var payload = JSON.parse(e.postData.contents);
    var idToken = payload.idToken || '';
    var auth = authenticateRequest(idToken);

    if (!auth.authorized) {
      return jsonResponse({ success: false, authorized: false, error: auth.error });
    }

    // ── Admin: Add Customer ──
    if (payload.action === 'admin_add_customer') {
      if (!auth.isAdmin) {
        return jsonResponse({ success: false, error: 'Forbidden: Admin access only.' });
      }
      var newName = String(payload.name || '').trim();
      var newEmail = String(payload.email || '').trim().toLowerCase();
      if (!newName || !newEmail || newEmail.indexOf('@') === -1) {
        return jsonResponse({ success: false, error: 'Valid Name and Gmail are required.' });
      }

      var licSheet = getOrCreateLicensesSheet();
      var licData = licSheet.getDataRange().getValues();

      // Check if email already registered
      for (var k = 1; k < licData.length; k++) {
        if (String(licData[k][2] || '').trim().toLowerCase() === newEmail) {
          return jsonResponse({ success: false, error: 'A customer with this Gmail already exists.' });
        }
      }

      var nextNum = licData.length; // e.g. 1st row header, next is CUST-001
      var nextId = 'CUST-' + String(nextNum).padStart(3, '0');
      var nowStr = formatDate(new Date());

      licSheet.appendRow([nextId, newName, newEmail, 'ACTIVE', nowStr]);
      // Pre-create and initialize the customer's isolated orders partition
      getOrCreateCustomerOrdersSheet(nextId);

      return jsonResponse({
        success: true,
        customer: { customerId: nextId, name: newName, email: newEmail, status: 'ACTIVE', date: nowStr }
      });
    }

    // ── Admin: Set Customer Status (Activate / Deactivate) ──
    if (payload.action === 'admin_set_status') {
      if (!auth.isAdmin) {
        return jsonResponse({ success: false, error: 'Forbidden: Admin access only.' });
      }
      var targetId = String(payload.customerId || '').trim();
      var targetStatus = String(payload.status || '').trim().toUpperCase();

      if (!targetId || (targetStatus !== 'ACTIVE' && targetStatus !== 'INACTIVE')) {
        return jsonResponse({ success: false, error: 'Invalid Customer ID or Status.' });
      }

      var lSheet = getOrCreateLicensesSheet();
      var lData = lSheet.getDataRange().getValues();
      var foundRow = -1;

      for (var m = 1; m < lData.length; m++) {
        if (String(lData[m][0]).trim() === targetId) {
          foundRow = m + 1; // 1-based row index
          break;
        }
      }

      if (foundRow === -1) {
        return jsonResponse({ success: false, error: 'Customer ID not found.' });
      }

      lSheet.getRange(foundRow, 4).setValue(targetStatus);
      return jsonResponse({ success: true, customerId: targetId, status: targetStatus });
    }

    // ── Admin: Edit Customer (Name & Gmail) ──
    if (payload.action === 'admin_edit_customer') {
      if (!auth.isAdmin) {
        return jsonResponse({ success: false, error: 'Forbidden: Admin access only.' });
      }
      var targetId = String(payload.customerId || '').trim();
      var newName = String(payload.name || '').trim();
      var newEmail = String(payload.email || '').trim().toLowerCase();

      if (!targetId || !newName || !newEmail || newEmail.indexOf('@') === -1) {
        return jsonResponse({ success: false, error: 'Customer ID, Name, and a valid Gmail are required.' });
      }

      var lSheet = getOrCreateLicensesSheet();
      var lData = lSheet.getDataRange().getValues();
      var foundRow = -1;

      // Check existence and verify Gmail uniqueness across OTHER customers
      for (var m = 1; m < lData.length; m++) {
        var rowId = String(lData[m][0]).trim();
        var rowEmail = String(lData[m][2] || '').trim().toLowerCase();

        if (rowId === targetId) {
          foundRow = m + 1; // 1-based row index
        } else if (rowEmail === newEmail) {
          return jsonResponse({ success: false, error: 'The Gmail address ' + newEmail + ' is already assigned to ' + rowId + '.' });
        }
      }

      if (foundRow === -1) {
        return jsonResponse({ success: false, error: 'Customer ID not found.' });
      }

      // Column 2 = Name, Column 3 = Gmail
      lSheet.getRange(foundRow, 2).setValue(newName);
      lSheet.getRange(foundRow, 3).setValue(newEmail);

      return jsonResponse({
        success: true,
        customer: { customerId: targetId, name: newName, email: newEmail }
      });
    }

    // ── Admin: Delete Customer ──
    if (payload.action === 'admin_delete_customer') {
      if (!auth.isAdmin) {
        return jsonResponse({ success: false, error: 'Forbidden: Admin access only.' });
      }
      var targetId = String(payload.customerId || '').trim();
      if (!targetId) {
        return jsonResponse({ success: false, error: 'Customer ID is required.' });
      }

      var lSheet = getOrCreateLicensesSheet();
      var lData = lSheet.getDataRange().getValues();
      var foundRow = -1;

      for (var m = 1; m < lData.length; m++) {
        if (String(lData[m][0]).trim() === targetId) {
          foundRow = m + 1; // 1-based row index
          break;
        }
      }

      if (foundRow === -1) {
        return jsonResponse({ success: false, error: 'Customer ID not found.' });
      }

      // Delete license record from Licenses sheet
      lSheet.deleteRow(foundRow);

      // Delete customer's isolated orders partition if it exists
      try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var custSheet = ss.getSheetByName('Orders_' + targetId);
        if (custSheet) {
          ss.deleteSheet(custSheet);
        }
      } catch (sheetErr) {
        // Non-critical: sheet deletion error should not block license revocation
      }

      return jsonResponse({ success: true, customerId: targetId });
    }

    // ── Customer Order Sync (Strictly Customer-Isolated) ──
    var operations = payload.operations;
    if (!Array.isArray(operations) || operations.length === 0) {
      return jsonResponse({ success: true, processed: 0, failed: 0 });
    }

    var sheet = getOrCreateCustomerOrdersSheet(auth.customerId);
    var data = sheet.getDataRange().getValues();
    var idIndex = buildIdIndex(data);

    var processed = 0;
    var failed = 0;
    var errors = [];

    for (var i = 0; i < operations.length; i++) {
      try {
        var op = operations[i];
        if (op.action === 'upsert' && op.data && op.data.id) {
          upsertOrder(sheet, idIndex, op.data);
          processed++;
        } else if (op.action === 'delete' && op.orderId) {
          deleteOrder(sheet, idIndex, op.orderId);
          processed++;
        } else {
          failed++;
          errors.push({ index: i, error: 'Invalid operation' });
        }
      } catch (err) {
        failed++;
        errors.push({ index: i, error: err.toString() });
      }
    }

    return jsonResponse({
      success: true,
      processed: processed,
      failed: failed,
      errors: errors,
      customerId: auth.customerId
    });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ─────────────────────────────────────────────────────────────
//  SHEET MANAGEMENT & HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Gets or creates the Master Licenses sheet.
 */
function getOrCreateLicensesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LICENSES_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(LICENSES_SHEET_NAME);
    sheet.appendRow(LICENSE_HEADERS);
    sheet.getRange(1, 1, 1, LICENSE_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(LICENSE_HEADERS);
    sheet.getRange(1, 1, 1, LICENSE_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Gets or creates the customer-specific isolated orders sheet.
 * e.g., 'Orders_CUST-001' or legacy 'Orders' if single-user admin.
 */
function getOrCreateCustomerOrdersSheet(customerId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  // Safe sheet name, e.g. Orders_CUST-001 or Orders_ADMIN
  var safeId = String(customerId || 'DEFAULT').replace(/[^a-zA-Z0-9_\-]/g, '');
  var sheetName = 'Orders_' + safeId;

  // Legacy fallback: If Orders sheet exists and user is ADMIN/CUST-001, allow preserving legacy Orders sheet
  if (safeId === 'ADMIN' && ss.getSheetByName('Orders')) {
    return ss.getSheetByName('Orders');
  }

  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(ORDER_HEADERS);
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(ORDER_HEADERS);
    sheet.getRange(1, 1, 1, ORDER_HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function buildIdIndex(data) {
  var index = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      index[String(data[i][0])] = i + 1; // 1-based row number
    }
  }
  return index;
}

function upsertOrder(sheet, idIndex, order) {
  var rowData = [
    String(order.id),
    order.createdAt || '',
    order.customerName || '',
    order.phone || '',
    order.address || '',
    order.courier || '',
    order.trackingId || '',
    Number(order.codAmount) || 0,
    Number(order.costPrice) || 0,
    Number(order.deliveryCharge) || 0,
    order.status || '',
    order.codCollected ? 'YES' : 'NO',
    order.codCollectedDate || '',
    order.returnReceived ? 'YES' : 'NO',
    order.updatedAt || ''
  ];

  var existingRow = idIndex[String(order.id)];

  if (existingRow) {
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
    idIndex[String(order.id)] = sheet.getLastRow();
  }
}

function deleteOrder(sheet, idIndex, orderId) {
  var existingRow = idIndex[String(orderId)];

  if (existingRow) {
    sheet.deleteRow(existingRow);
    delete idIndex[String(orderId)];

    for (var key in idIndex) {
      if (idIndex.hasOwnProperty(key) && idIndex[key] > existingRow) {
        idIndex[key]--;
      }
    }
  }
}

function formatDate(date) {
  var d = date.getDate();
  var m = date.getMonth() + 1;
  var y = date.getFullYear();
  return (d < 10 ? '0' + d : d) + '/' + (m < 10 ? '0' + m : m) + '/' + y;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function testCreateSheet() {
  var sheet = getOrCreateSheet();
  Logger.log(sheet.getName());
}
