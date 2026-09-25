/**
 * BIKRI HUB — Google Apps Script Backend
 * 
 * This script receives order data from Bikri Hub and stores it
 * in a Google Sheet as a persistent cloud backup.
 *
 * SETUP:
 * 1. Open Google Sheets → create a new spreadsheet (e.g., "Bikri Hub Orders")
 * 2. Go to Extensions → Apps Script
 * 3. Delete any existing code in Code.gs
 * 4. Paste this entire script into Code.gs
 * 5. Click Deploy → New deployment
 * 6. Select type: "Web app"
 * 7. Set "Execute as": Me
 * 8. Set "Who has access": Anyone
 * 9. Click Deploy → Authorize when prompted
 * 10. Copy the Web App URL
 * 11. Paste the URL into Bikri Hub → Settings → Google Apps Script URL
 * 12. Click "Save Settings" → Bikri Hub will offer to push existing orders
 *
 * The script will automatically create an "Orders" sheet with headers.
 */

var SHEET_NAME = 'Orders';
var HEADERS = [
  'Order ID', 'Created Date', 'Customer Name', 'Phone', 'Address',
  'Courier', 'Tracking ID', 'COD Amount', 'Item Cost', 'Delivery Cost',
  'Status', 'COD Collected', 'COD Collected Date', 'Return Received', 'Updated Date'
];

/**
 * Handles POST requests from Bikri Hub.
 * Receives a JSON payload with batch operations (upsert/delete).
 */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Wait up to 30 seconds for concurrent requests to finish
    lock.waitLock(30000);
  } catch (lockErr) {
    return jsonResponse({ success: false, error: 'Server busy — please retry in a moment' });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, error: 'No data received' });
    }

    var payload = JSON.parse(e.postData.contents);
    var operations = payload.operations;

    if (!Array.isArray(operations) || operations.length === 0) {
      return jsonResponse({ success: true, processed: 0, failed: 0 });
    }

    var sheet = getOrCreateSheet();

    // Build an index of existing Order IDs → row numbers for fast lookup
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
      errors: errors
    });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Handles GET requests from Bikri Hub.
 * Used to fetch all orders for cloud restore.
 */
function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';

    if (action === 'fetch') {
      var sheet = getOrCreateSheet();
      var data = sheet.getDataRange().getValues();

      if (data.length <= 1) {
        return jsonResponse({ success: true, orders: [] });
      }

      var orders = [];
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        if (!row[0]) continue; // skip empty rows

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

      return jsonResponse({ success: true, orders: orders });
    }

    // Default: health check
    return jsonResponse({
      success: true,
      message: 'Bikri Hub Google Sheets backend is running.'
    });

  } catch (err) {
    return jsonResponse({ success: false, error: err.toString() });
  }
}

// ──────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────

/**
 * Gets or creates the Orders sheet with headers.
 */
function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Builds a map of Order ID → row number (1-based) for fast lookup.
 */
function buildIdIndex(data) {
  var index = {};
  for (var i = 1; i < data.length; i++) {
    if (data[i][0]) {
      index[String(data[i][0])] = i + 1; // 1-based row number
    }
  }
  return index;
}

/**
 * Upserts an order: updates existing row or appends new one.
 */
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
    // Update existing row in place
    sheet.getRange(existingRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    // Append new row
    sheet.appendRow(rowData);
    // Update index for subsequent operations in the same batch
    idIndex[String(order.id)] = sheet.getLastRow();
  }
}

/**
 * Deletes an order row by Order ID.
 * Adjusts the index for subsequent operations in the same batch.
 */
function deleteOrder(sheet, idIndex, orderId) {
  var existingRow = idIndex[String(orderId)];

  if (existingRow) {
    sheet.deleteRow(existingRow);
    delete idIndex[String(orderId)];

    // Adjust row numbers for all entries after the deleted row
    for (var key in idIndex) {
      if (idIndex.hasOwnProperty(key) && idIndex[key] > existingRow) {
        idIndex[key]--;
      }
    }
  }
  // If not found, consider it already deleted — still counts as processed
}

/**
 * Returns a JSON response with proper MIME type.
 */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
