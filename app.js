import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query, orderBy, serverTimestamp, getDocs, where } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

// --- DOM Elements ---
const navLinks = document.querySelectorAll('.nav-link');
const pageSections = document.querySelectorAll('.page-section');
const pageTitle = document.getElementById('page-title');

// Stats
const statTotalProducts = document.getElementById('stat-total-products');
const statTotalStock = document.getElementById('stat-total-stock');
const statLowStock = document.getElementById('stat-low-stock');
const statSalesToday = document.getElementById('stat-sales-today');

// Forms
const addProductForm = document.getElementById('add-product-form');
const recordSaleForm = document.getElementById('record-sale-form');

// Tables & Feeds
const inventoryTbody = document.getElementById('inventory-tbody');
const searchInventory = document.getElementById('search-inventory');
const saleProductDropdown = document.getElementById('sale-product');
const saleCurrentStock = document.getElementById('sale-current-stock');
const saleQtyInput = document.getElementById('sale-qty');
const alertsFeed = document.getElementById('alerts-feed');
const salesFeed = document.getElementById('sales-feed');

// Modals
const editModal = document.getElementById('edit-modal');
const closeEditModalBtn = document.querySelector('.close-modal');
const editProductForm = document.getElementById('edit-product-form');

// --- Application State ---
let products = [];
let sales = [];
let alerts = [];
let salesChart = null;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initRealtimeListeners();
    initForms();
    initModals();
});

// --- Toast System ---
function showToast(message, type = 'success') {
    const toastContainer = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';
    
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Navigation ---
function initNavigation() {
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('data-target');
            
            // Update Active Link
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            // Update Page Title
            pageTitle.textContent = link.textContent.replace(/[^\x00-\x7F]/g, "").trim(); // Remove emoji
            
            // Show Target Section
            pageSections.forEach(sec => sec.classList.add('hidden'));
            document.getElementById(targetId).classList.remove('hidden');

            // Refresh chart if navigating to analytics
            if(targetId === 'analytics-section' && salesChart) {
                salesChart.update();
            }
        });
    });
}

// --- Real-time Listeners ---
function initRealtimeListeners() {
    // 1. Products Listener
    const qProducts = query(collection(db, "products"), orderBy("createdAt", "desc"));
    onSnapshot(qProducts, (snapshot) => {
        products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderInventoryTable();
        updateDashboardStats();
        updateSaleDropdown();
        generateLowStockAlerts();
    }, (error) => {
        console.error("Error listening to products:", error);
        showToast("Error connecting to database", "error");
    });

    // 2. Sales Listener
    const qSales = query(collection(db, "sales"), orderBy("soldAt", "desc"));
    onSnapshot(qSales, (snapshot) => {
        sales = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderSalesFeed();
        updateDashboardStats();
        renderAnalytics();
    });

    // 3. Alerts Listener
    const qAlerts = query(collection(db, "alerts"), orderBy("createdAt", "desc"));
    onSnapshot(qAlerts, (snapshot) => {
        alerts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderAlertsFeed();
    });
}

// --- Forms & Inputs ---
function initForms() {
    // Add Product
    addProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-save-product');
        btn.disabled = true;
        btn.textContent = "Saving...";

        const newProduct = {
            productName: document.getElementById('prod-name').value,
            sku: document.getElementById('prod-sku').value,
            category: document.getElementById('prod-category').value,
            price: parseFloat(document.getElementById('prod-price').value),
            quantity: parseInt(document.getElementById('prod-qty').value),
            lowStockLimit: parseInt(document.getElementById('prod-threshold').value),
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        };

        try {
            await addDoc(collection(db, "products"), newProduct);
            showToast("Product added successfully!");
            addProductForm.reset();
            // Switch back to inventory
            document.querySelector('[data-target="inventory-section"]').click();
        } catch (error) {
            console.error("Error adding product:", error);
            showToast("Failed to add product.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Save Product";
        }
    });

    // Record Sale
    saleProductDropdown.addEventListener('change', (e) => {
        const prodId = e.target.value;
        const product = products.find(p => p.id === prodId);
        if (product) {
            saleCurrentStock.value = product.quantity;
            saleQtyInput.max = product.quantity;
        } else {
            saleCurrentStock.value = "-";
        }
    });

    recordSaleForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('btn-record-sale');
        
        const productId = saleProductDropdown.value;
        const qtySold = parseInt(saleQtyInput.value);
        
        if(!productId) {
            showToast("Please select a product.", "warning");
            return;
        }

        const product = products.find(p => p.id === productId);
        if(!product || product.quantity < qtySold) {
            showToast("Insufficient stock for this sale.", "error");
            return;
        }

        btn.disabled = true;
        btn.textContent = "Processing...";

        try {
            // 1. Add Sale Record
            const saleRecord = {
                productId: product.id,
                productName: product.productName,
                quantitySold: qtySold,
                unitPrice: product.price,
                totalAmount: product.price * qtySold,
                soldAt: serverTimestamp()
            };
            await addDoc(collection(db, "sales"), saleRecord);

            // 2. Reduce Product Stock
            const prodRef = doc(db, "products", product.id);
            await updateDoc(prodRef, {
                quantity: product.quantity - qtySold,
                updatedAt: serverTimestamp()
            });

            showToast("Sale recorded successfully!");
            recordSaleForm.reset();
            saleCurrentStock.value = "-";
        } catch (error) {
            console.error("Error recording sale:", error);
            showToast("Failed to record sale.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Confirm Sale";
        }
    });

    // Search Inventory
    searchInventory.addEventListener('input', (e) => {
        renderInventoryTable(e.target.value);
    });
}

function initModals() {
    closeEditModalBtn.addEventListener('click', () => editModal.classList.add('hidden'));
    
    // Close modal if clicked outside
    window.addEventListener('click', (e) => {
        if (e.target === editModal) {
            editModal.classList.add('hidden');
        }
    });

    // Handle Stock Update
    editProductForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-prod-id').value;
        const newQty = parseInt(document.getElementById('edit-prod-qty').value);
        const btn = editProductForm.querySelector('button[type="submit"]');

        btn.disabled = true;
        btn.textContent = "Updating...";

        try {
            await updateDoc(doc(db, "products", id), {
                quantity: newQty,
                updatedAt: serverTimestamp()
            });
            showToast("Stock updated successfully!");
            editModal.classList.add('hidden');
        } catch (error) {
            console.error("Error updating stock:", error);
            showToast("Failed to update stock.", "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Update Stock";
        }
    });
}

// --- Logic & Render Functions ---

function renderInventoryTable(searchTerm = "") {
    inventoryTbody.innerHTML = "";
    
    const term = searchTerm.toLowerCase();
    const filteredProducts = products.filter(p => 
        p.productName.toLowerCase().includes(term) || 
        p.sku.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
    );

    if (filteredProducts.length === 0) {
        inventoryTbody.innerHTML = `<tr><td colspan="7" class="text-center empty-state">No products found.</td></tr>`;
        return;
    }

    filteredProducts.forEach(product => {
        const tr = document.createElement('tr');
        
        let statusBadge = `<span class="badge badge-success">In Stock</span>`;
        if (product.quantity <= 0) {
            statusBadge = `<span class="badge badge-danger">Out of Stock</span>`;
        } else if (product.quantity <= product.lowStockLimit) {
            statusBadge = `<span class="badge badge-warning">Low Stock</span>`;
        }

        tr.innerHTML = `
            <td><strong>${product.sku}</strong></td>
            <td>${product.productName}</td>
            <td>${product.category}</td>
            <td>$${product.price.toFixed(2)}</td>
            <td><strong>${product.quantity}</strong></td>
            <td>${statusBadge}</td>
            <td class="table-actions">
                <button class="btn btn-sm btn-primary btn-edit" data-id="${product.id}" data-qty="${product.quantity}">Edit Stock</button>
                <button class="btn btn-sm btn-danger btn-delete" data-id="${product.id}">Delete</button>
            </td>
        `;
        inventoryTbody.appendChild(tr);
    });

    // Attach Event Listeners to dynamic buttons
    document.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            const qty = e.target.getAttribute('data-qty');
            document.getElementById('edit-prod-id').value = id;
            document.getElementById('edit-prod-qty').value = qty;
            editModal.classList.remove('hidden');
        });
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = e.target.getAttribute('data-id');
            if(confirm("Are you sure you want to delete this product?")) {
                try {
                    await deleteDoc(doc(db, "products", id));
                    showToast("Product deleted.");
                } catch (error) {
                    showToast("Failed to delete product.", "error");
                }
            }
        });
    });
}

function updateSaleDropdown() {
    // Save current selection if exists
    const currentVal = saleProductDropdown.value;
    
    saleProductDropdown.innerHTML = `<option value="" disabled selected>Select Product...</option>`;
    products.forEach(p => {
        if(p.quantity > 0) {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = `${p.productName} (Stock: ${p.quantity}) - $${p.price.toFixed(2)}`;
            saleProductDropdown.appendChild(option);
        }
    });

    if(currentVal && products.find(p => p.id === currentVal && p.quantity > 0)) {
        saleProductDropdown.value = currentVal;
    }
}

function updateDashboardStats() {
    statTotalProducts.textContent = products.length;
    
    const totalStock = products.reduce((sum, p) => sum + p.quantity, 0);
    statTotalStock.textContent = totalStock;

    const lowStockCount = products.filter(p => p.quantity > 0 && p.quantity <= p.lowStockLimit).length;
    statLowStock.textContent = lowStockCount;

    // Calculate today's sales
    const today = new Date();
    today.setHours(0,0,0,0);
    
    let dailySalesTotal = 0;
    sales.forEach(sale => {
        if(sale.soldAt && sale.soldAt.toDate) {
            const saleDate = sale.soldAt.toDate();
            if(saleDate >= today) {
                dailySalesTotal += sale.totalAmount;
            }
        }
    });
    statSalesToday.textContent = `$${dailySalesTotal.toFixed(2)}`;
}

async function generateLowStockAlerts() {
    for(const p of products) {
        if(p.quantity <= p.lowStockLimit && p.quantity > 0) {
            // Check if alert already exists recently to prevent spam
            // For simplicity in this architecture, we will check if an unresolved alert exists
            const existingAlert = alerts.find(a => a.productId === p.id && !a.resolved);
            if(!existingAlert) {
                await addDoc(collection(db, "alerts"), {
                    productId: p.id,
                    productName: p.productName,
                    alertType: 'LOW_STOCK',
                    message: `${p.productName} is low on stock (${p.quantity} remaining).`,
                    createdAt: serverTimestamp(),
                    resolved: false
                });
                showToast(`${p.productName} stock is low!`, "warning");
            }
        }
        
        // Auto resolve alert if stock goes up
        if(p.quantity > p.lowStockLimit) {
            const activeAlerts = alerts.filter(a => a.productId === p.id && !a.resolved);
            for(const a of activeAlerts) {
                await updateDoc(doc(db, "alerts", a.id), {
                    resolved: true,
                    updatedAt: serverTimestamp()
                });
            }
        }
    }
}

function renderAlertsFeed() {
    alertsFeed.innerHTML = "";
    // Only show unresolved
    const activeAlerts = alerts.filter(a => !a.resolved).slice(0, 5);
    
    if(activeAlerts.length === 0) {
        alertsFeed.innerHTML = `<li class="empty-state">All good! No active alerts.</li>`;
        return;
    }

    activeAlerts.forEach(a => {
        const timeStr = a.createdAt && a.createdAt.toDate ? a.createdAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Just now';
        alertsFeed.innerHTML += `
            <li>
                <span>⚠️ ${a.message}</span>
                <span class="activity-time">${timeStr}</span>
            </li>
        `;
    });
}

function renderSalesFeed() {
    salesFeed.innerHTML = "";
    const recentSales = sales.slice(0, 5); // Take top 5 recent (since it's ordered desc)
    
    if(recentSales.length === 0) {
        salesFeed.innerHTML = `<li class="empty-state">No recent sales.</li>`;
        return;
    }

    recentSales.forEach(s => {
        const timeStr = s.soldAt && s.soldAt.toDate ? s.soldAt.toDate().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Just now';
        salesFeed.innerHTML += `
            <li>
                <span>🛒 Sold ${s.quantitySold}x ${s.productName} for <strong>$${s.totalAmount.toFixed(2)}</strong></span>
                <span class="activity-time">${timeStr}</span>
            </li>
        `;
    });
}

function renderAnalytics() {
    const ctx = document.getElementById('salesChart').getContext('2d');
    
    // Aggregate sales by product
    const productSalesMap = {};
    sales.forEach(sale => {
        if(!productSalesMap[sale.productName]) {
            productSalesMap[sale.productName] = 0;
        }
        productSalesMap[sale.productName] += sale.quantitySold;
    });

    // Sort to get Top 5
    const sortedProducts = Object.keys(productSalesMap).sort((a, b) => productSalesMap[b] - productSalesMap[a]).slice(0, 5);
    const dataValues = sortedProducts.map(p => productSalesMap[p]);

    if(salesChart) {
        salesChart.destroy();
    }

    salesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedProducts.length ? sortedProducts : ['No Data'],
            datasets: [{
                label: 'Units Sold (Top 5)',
                data: dataValues.length ? dataValues : [0],
                backgroundColor: 'rgba(79, 70, 229, 0.6)',
                borderColor: 'rgba(79, 70, 229, 1)',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}
