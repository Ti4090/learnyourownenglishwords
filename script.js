// ==================== GLOBAL STATE ====================
const STORAGE_KEY = 'myVocabApp_v1';
const BACKUP_KEY = 'myVocabApp_v1_backup';
const NOTES_KEY = 'myVocabApp_notes';

let state = {
    meta: {
        version: '1.0',
        createdAt: new Date().toISOString(),
        lastSync: new Date().toISOString()
    },
    settings: {
        theme: 'light',
        notificationHour: '20:00',
        notificationEnabled: false,
        dailyTestTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    categories: [],
    words: {},
    history: [],
    appStats: {
        totalAdded: 0,
        totalLearned: 0,
        favoritesCount: 0,
        hardCount: 0,
        streak: { current: 0, best: 0, lastActive: null }
    }
};

let currentQuiz = null;
let notificationCheckInterval = null;
let snoozedUntil = null;

// ==================== UTILITY FUNCTIONS ====================
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Helper to read first existing field value from a list of possible IDs
function getFirstFieldValue(...ids) {
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) return (el.value || '').trim();
    }
    return '';
}

// Helper to read first existing property from a word object (aliases)
function getWordField(word, ...keys) {
    if (!word) return '';
    for (const k of keys) {
        if (word[k]) return word[k];
    }
    return '';
}

function copyPermalink(id) {
    try {
        const url = `${location.origin}${location.pathname}#word:${encodeURIComponent(id)}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => showToast('Link panoya kopyalandı.', 'success'));
        } else {
            // Fallback: prompt with URL
            const ta = document.createElement('textarea');
            ta.value = url; document.body.appendChild(ta); ta.select();
            document.execCommand('copy'); ta.remove();
            showToast('Link panoya kopyalandı (fallback).', 'success');
        }
    } catch (err) {
        console.error('copyPermalink error', err);
        showToast('Link kopyalanamadı.', 'error');
    }
}

function formatDate(isoString) {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    return date.toLocaleDateString();
}
    
function saveState() {
    try {
        // create a backup of current storage
        const currentData = localStorage.getItem(STORAGE_KEY);
        if (currentData) {
            localStorage.setItem(BACKUP_KEY, currentData);
        }

        state.meta.lastSync = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        updateStorageDisplay();
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            showToast('Storage quota exceeded! Please export your data and clear some space.', 'error');
        } else {
            console.error('Error saving state:', error);
        }
    }
}

const debouncedSaveState = debounce(saveState, 1000);

function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const loaded = JSON.parse(saved);
            state = { ...state, ...loaded };
        }
        updateStats();
    } catch (error) {
        console.error('Error loading state:', error);
        showToast('Error loading data. Starting fresh.', 'error');
    }
}

function updateStorageDisplay() {
    const data = localStorage.getItem(STORAGE_KEY) || '';
    const bytes = new Blob([data]).size;
    const kb = (bytes / 1024).toFixed(2);
    document.getElementById('storage-usage').textContent = `Storage: ${kb} KB`;
}

function exportData() {
    const dataStr = JSON.stringify(state, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    const date = new Date().toISOString().split('T')[0].replace(/-/g, '');
    link.download = `vocab_backup_${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Data exported successfully!', 'success');
}

function importData(fileContent, mode = 'replace') {
    try {
        const imported = JSON.parse(fileContent);
        
        if (!imported.meta || !imported.words) {
            throw new Error('Invalid backup file format');
        }
        
        if (mode === 'replace') {
            state = imported;
            showToast('Data imported successfully!', 'success');
        } else if (mode === 'merge') {
            // Merge words, avoiding duplicates
            let merged = 0;
            let skipped = 0;
            
            Object.values(imported.words).forEach(word => {
                const exists = Object.values(state.words).find(
                    w => w.english.toLowerCase() === word.english.toLowerCase() && 
                         w.turkish.toLowerCase() === word.turkish.toLowerCase()
                );
                
                if (!exists) {
                    state.words[word.id] = word;
                    merged++;
                } else {
                    skipped++;
                }
            });
            
            showToast(`Merged ${merged} words, skipped ${skipped} duplicates.`, 'success');
        }
        
        saveState();
        updateStats();
        navigateTo('dictionary');
    } catch (error) {
        console.error('Import error:', error);
        showToast('Error importing data. Please check the file format.', 'error');
    }
}

// ==================== WORD CRUD FUNCTIONS ====================
function addWord(wordData) {
    const id = generateUUID();
    const word = {
        id,
        english: wordData.english.trim(),
        turkish: wordData.turkish?.trim() || '',
        pronunciation: wordData.pronunciation?.trim() || '',
        turkishExplanation: wordData.turkishExplanation?.trim() || '',
        englishExplanation: wordData.englishExplanation?.trim() || '',
        synonyms: wordData.synonyms || [],
        antonyms: wordData.antonyms || [],
        examples: wordData.examples || [],
        level: wordData.level || 'C1',
        categories: wordData.categories || [],
    notes: wordData.notes?.trim() || '',
        favorite: wordData.favorite || false,
        stats: {
            addedAt: new Date().toISOString(),
            timesTested: 0,
            correctCount: 0,
            wrongCount: 0,
            lastTested: null,
            difficultyScore: 0,
            nextReviewDate: new Date().toISOString(),
            learned: false
        }
    };
    // Mirror Turkish explanation across known aliases so renderers/readers find it
    word.turkExp = word.turkishExplanation;
    word.turkishExp = word.turkishExplanation;
    
    state.words[id] = word;
    state.appStats.totalAdded = Object.keys(state.words).length;
    updateStats();
    debouncedSaveState();
    return word;
}

// Find possible duplicate by english (case-insensitive) or turkish
function findDuplicate(english, turkish) {
    if (!english) return null;
    const e = english.trim().toLowerCase();
    const t = (turkish || '').trim().toLowerCase();
    return Object.values(state.words).find(w => {
        if (w.english && w.english.trim().toLowerCase() === e) return true;
        if (t && w.turkish && w.turkish.trim().toLowerCase() === t) return true;
        return false;
    }) || null;
}

function updateWord(id, wordData) {
    if (!state.words[id]) return null;
    
    state.words[id] = {
        ...state.words[id],
        ...wordData,
        stats: state.words[id].stats // Preserve stats
    };
    // Normalize Turkish explanation aliases if provided
    const updated = state.words[id];
    if (wordData.turkishExplanation !== undefined) {
        updated.turkExp = (wordData.turkishExplanation || '').trim();
        updated.turkishExp = (wordData.turkishExplanation || '').trim();
        updated.turkishExplanation = (wordData.turkishExplanation || '').trim();
    }

    if (wordData.notes !== undefined) {
        updated.notes = (wordData.notes || '').trim();
    }
    
    updateStats();
    debouncedSaveState();
    return state.words[id];
}

function deleteWord(id) {
    if (state.words[id]) {
        delete state.words[id];
        state.appStats.totalAdded = Object.keys(state.words).length;
        updateStats();
        debouncedSaveState();
        return true;
    }
    return false;
}

function toggleFavorite(id) {
    if (state.words[id]) {
        state.words[id].favorite = !state.words[id].favorite;
        updateStats();
        debouncedSaveState();
        return state.words[id].favorite;
    }
    return false;
}

function updateWordStats(id, correct) {
    const word = state.words[id];
    if (!word) return;
    
    word.stats.timesTested++;
    word.stats.lastTested = new Date().toISOString();
    
    if (correct) {
        word.stats.correctCount++;
        word.stats.difficultyScore = Math.max(0, word.stats.difficultyScore - 1);
        
        // Spaced repetition intervals: 1, 3, 7, 14, 30, 90 days
        const intervals = [1, 3, 7, 14, 30, 90];
        const streak = word.stats.correctCount - word.stats.wrongCount;
        const intervalIndex = Math.min(Math.max(0, streak - 1), intervals.length - 1);
        const days = intervals[intervalIndex];
        
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + days);
        word.stats.nextReviewDate = nextDate.toISOString();
    } else {
        word.stats.wrongCount++;
        word.stats.difficultyScore += 2;
        
        // Reset review to tomorrow
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        word.stats.nextReviewDate = tomorrow.toISOString();
    }
    
    // Check if word is learned
    if (word.stats.correctCount >= 5 && word.stats.wrongCount === 0) {
        word.stats.learned = true;
    }
    
    updateStats();
    debouncedSaveState();
}

// ==================== STATISTICS FUNCTIONS ====================
function updateStats() {
    const words = Object.values(state.words);
    
    state.appStats.totalAdded = words.length;
    state.appStats.totalLearned = words.filter(w => w.stats.learned).length;
    state.appStats.favoritesCount = words.filter(w => w.favorite).length;
    state.appStats.hardCount = words.filter(w => isHardWord(w)).length;
    
    // Update header stats
    document.getElementById('stat-total').textContent = state.appStats.totalAdded;
    document.getElementById('stat-learned').textContent = state.appStats.totalLearned;
    document.getElementById('stat-fav').textContent = state.appStats.favoritesCount;
    document.getElementById('stat-hard').textContent = state.appStats.hardCount;
    document.getElementById('stat-streak').textContent = state.appStats.streak.current;
}

function isHardWord(word) {
    return word.stats.difficultyScore >= 3 || 
           (word.stats.timesTested >= 3 && word.stats.wrongCount / word.stats.timesTested >= 0.4);
}

function getWordsByCategory(category) {
    return Object.values(state.words).filter(w => w.categories.includes(category));
}

function getAllCategories() {
    const categories = new Set();
    Object.values(state.words).forEach(w => {
        w.categories.forEach(cat => categories.add(cat));
    });
    // Include top-level categories list stored in state
    if (Array.isArray(state.categories)) {
        state.categories.forEach(cat => categories.add(cat));
    }
    return Array.from(categories).sort();
}

function getDueWords() {
    const now = new Date();
    return Object.values(state.words).filter(w => {
        const dueDate = new Date(w.stats.nextReviewDate);
        return dueDate <= now;
    });
}

// ==================== TEXT-TO-SPEECH ====================
function playPronunciation(text, button) {
    if (!('speechSynthesis' in window)) {
        showToast('Text-to-speech is not supported in your browser.', 'warning');
        return;
    }
    
    if (button) {
        button.classList.add('playing');
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    
    utterance.onend = () => {
        if (button) {
            button.classList.remove('playing');
        }
    };
    
    speechSynthesis.cancel(); // Cancel any ongoing speech
    speechSynthesis.speak(utterance);
}

// ==================== SPA ROUTER ====================
function navigateTo(route) {
    window.location.hash = route;
}

function handleRoute() {
    const route = window.location.hash.slice(1) || 'dashboard';
    // For category detail routes like "category:Name" or "category/Name" map to base 'categories' nav
    const finalRouteForNav = route.startsWith('category:') || route.startsWith('category/') ? 'categories' : route;

    // Close any open modal when route changes
    document.querySelectorAll('.modal.active').forEach(modal => {
        modal.classList.remove('active');
    });

    // Update active nav item
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.route === finalRouteForNav) {
            item.classList.add('active');
        }
    });
    
    // Render appropriate view
    const mainContent = document.getElementById('mainContent');
    
    // Route: category detail (allow both category:Name and category/Name)
    if (route.startsWith('category:') || route.startsWith('category/')) {
        const parts = route.split(/[:\/]/);
        const encoded = parts.slice(1).join(':');
        const catName = decodeURIComponent(encoded || '');
        viewCategory(catName);
        return;
    }

    // Route: word detail (word:<id> or word/<id>)
    if (route.startsWith('word:') || route.startsWith('word/')) {
        const parts = route.split(/[:\/]/);
        const id = parts.slice(1).join(':');
        const decodedId = decodeURIComponent(id || '');
        renderWordDetail(mainContent, decodedId);
        return;
    }

    switch (route) {
        case 'dashboard':
            renderDashboard(mainContent);
            break;
        case 'add-word':
            renderAddWord(mainContent);
            break;
        case 'learn':
            renderLearn(mainContent);
            break;
        case 'dictionary':
            renderDictionary(mainContent);
            break;
        case 'favorites':
            renderFavorites(mainContent);
            break;
        case 'hard':
            renderHardWords(mainContent);
            break;
        case 'categories':
            renderCategories(mainContent);
            break;
        case 'notes':
            renderNotes(mainContent);
            break;
        case 'statistics':
            renderStatistics(mainContent);
            break;
        case 'import-export':
            renderImportExport(mainContent);
            break;
        case 'quiz':
            if (currentQuiz) {
                renderQuiz(mainContent);
            } else {
                navigateTo('learn');
            }
            break;
        default:
            renderDashboard(mainContent);
    }
    
    // Close sidebar on mobile after navigation
    if (window.innerWidth <= 968) {
        document.getElementById('sidebar').classList.remove('active');
    }
}

// ==================== VIEW RENDERERS ====================
function renderDashboard(container) {
    const words = Object.values(state.words);
    const recentWords = words.sort((a, b) => 
        new Date(b.stats.addedAt) - new Date(a.stats.addedAt)
    ).slice(0, 6);
    
    const dueWords = getDueWords();
    
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-home"></i>
                Dashboard
            </h1>
            <p class="page-subtitle">Welcome back! Here's your learning overview.</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-primary);">${state.appStats.totalAdded}</div>
                <div class="stat-label">Total Words</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-success);">${state.appStats.totalLearned}</div>
                <div class="stat-label">Learned</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-warning);">${dueWords.length}</div>
                <div class="stat-label">Due for Review</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-primary);">${state.appStats.streak.current} 🔥</div>
                <div class="stat-label">Current Streak</div>
            </div>
        </div>
        
        <div style="margin-top: 2rem;">
            <h2>Quick Actions</h2>
            <div style="display: flex; gap: 1rem; margin-top: 1rem; flex-wrap: wrap;">
                <button class="btn-primary" onclick="openAddWordModal()" data-testid="button-add-word">
                    <i class="fas fa-plus"></i> Add New Word
                </button>
                <button class="btn-primary" onclick="navigateTo('learn')" data-testid="button-start-learning">
                    <i class="fas fa-graduation-cap"></i> Start Learning
                </button>
                ${dueWords.length >= 5 ? `
                    <button class="btn-secondary" onclick="startDailyTest()" data-testid="button-daily-test">
                        <i class="fas fa-calendar-check"></i> Daily Test (${dueWords.length} due)
                    </button>
                ` : ''}
            </div>
        </div>
        
        ${recentWords.length > 0 ? `
            <div style="margin-top: 2rem;">
                <h2>Recently Added</h2>
                <div class="card-grid">
                    ${recentWords.map(word => renderSimpleWordCard(word)).join('')}
                </div>
            </div>
        ` : `
            <div class="empty-state">
                <i class="fas fa-book-open"></i>
                <h3>No words yet</h3>
                <p>Start building your vocabulary by adding your first word!</p>
                <button class="btn-primary" onclick="openAddWordModal()">
                    <i class="fas fa-plus"></i> Add Your First Word
                </button>
            </div>
        `}
    `;
}

function renderSimpleWordCard(word) {
    return `
        <div class="simple-word-card" onclick="navigateTo('word:${word.id}')" data-testid="card-word-${word.id}">
            <div class="simple-word-english">${word.english}</div>
            <div class="simple-word-turkish">${word.turkish}</div>
        </div>
    `;
}

function renderLearn(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-graduation-cap"></i>
                Learn Words
            </h1>
            <p class="page-subtitle">Practice and test your vocabulary knowledge.</p>
        </div>
        
        <div class="card-grid">
            <div class="card" style="cursor: pointer;" onclick="openQuizConfig('all')" data-testid="card-quiz-all">
                <h3><i class="fas fa-list"></i> All Words</h3>
                <p style="color: var(--v-text-secondary); margin-top: 0.5rem;">
                    Practice all ${Object.keys(state.words).length} words in your dictionary
                </p>
            </div>
            
            <div class="card" style="cursor: pointer;" onclick="openQuizConfig('due')" data-testid="card-quiz-due">
                <h3><i class="fas fa-clock"></i> Due for Review</h3>
                <p style="color: var(--v-text-secondary); margin-top: 0.5rem;">
                    ${getDueWords().length} words ready for review
                </p>
            </div>
            
            <div class="card" style="cursor: pointer;" onclick="openQuizConfig('favorites')" data-testid="card-quiz-favorites">
                <h3><i class="fas fa-star"></i> Favorites</h3>
                <p style="color: var(--v-text-secondary); margin-top: 0.5rem;">
                    Practice your ${state.appStats.favoritesCount} favorite words
                </p>
            </div>
            
            <div class="card" style="cursor: pointer;" onclick="openQuizConfig('hard')" data-testid="card-quiz-hard">
                <h3><i class="fas fa-exclamation-triangle"></i> Hard Words</h3>
                <p style="color: var(--v-text-secondary); margin-top: 0.5rem;">
                    Focus on ${state.appStats.hardCount} challenging words
                </p>
            </div>
            
            <div class="card" style="cursor: pointer;" onclick="openQuizConfig('category')" data-testid="card-quiz-category">
                <h3><i class="fas fa-tags"></i> By Category</h3>
                <p style="color: var(--v-text-secondary); margin-top: 0.5rem;">
                    Choose from ${getAllCategories().length} categories
                </p>
            </div>

            <div class="card" style="cursor: pointer;" onclick="openQuizConfig('custom')" data-testid="card-quiz-custom">
                <h3><i class="fas fa-hand-pointer"></i> Custom Selection</h3>
                <p style="color: var(--v-text-secondary); margin-top: 0.5rem;">
                    Choose specific words to practice
                </p>
            </div>
            
            <div class="card" style="cursor: pointer;" onclick="navigateTo('dictionary')" data-testid="card-browse-words">
                <h3><i class="fas fa-book"></i> Browse Words</h3>
                <p style="color: var(--v-text-secondary); margin-top: 0.5rem;">
                    View and manage your dictionary
                </p>
            </div>
        </div>
    `;
    
}

// Toast notification system
function showToast(message, type = 'info') {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <i class="fas fa-${type === 'success' ? 'check-circle' : 
                          type === 'error' ? 'exclamation-circle' : 
                          type === 'warning' ? 'exclamation-triangle' : 'info-circle'}"></i>
        ${message}
    `;
    
    toastContainer.appendChild(toast);
    
    // Remove after animation
    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function validateWordForm(english, turkish, level) {
    let isValid = true;
    
    if (!english.trim()) {
        showToast('Lütfen İngilizce kelimeyi girin', 'error');
        isValid = false;
    }
    
    if (!turkish.trim()) {
        showToast('Lütfen Türkçe çevirisini girin', 'error');
        isValid = false;
    }
    
    if (!level) {
        showToast('Lütfen seviye seçin', 'error');
        isValid = false;
    }
    
    return isValid;
}

function handleAddWordFormSubmit(event) {
    event.preventDefault();
    
    // Get form elements
    const form = event.target;
    const isModal = form.id === 'word-form';
    const prefix = isModal ? 'f-' : 'page-';
    
    const englishInput = document.getElementById(prefix + 'english');
    const turkishInput = document.getElementById(prefix + 'turkish');
    const levelSelect = document.getElementById(prefix + 'level');
    
    if (!englishInput || !turkishInput || !levelSelect) {
        showToast('Form fields not found. Please try again.', 'error');
        return;
    }
    
    if (!validateWordForm(englishInput.value, turkishInput.value, levelSelect.value)) {
        return;
    }

    // Create formData
    const formData = {
        english: englishInput.value.trim(),
        turkish: turkishInput.value.trim(),
        pronunciation: document.getElementById(prefix + 'pron')?.value?.trim() || '',
        englishExplanation: getFirstFieldValue(prefix + 'engExp', prefix + 'englishExplanation') || '',
        turkishExplanation: getFirstFieldValue(prefix + 'turkExp', prefix + 'turkishExp', prefix + 'turkishExplanation') || '',
        level: levelSelect.value,
        synonyms: document.getElementById(prefix + 'syn')?.value?.split(',').map(s => s.trim()).filter(Boolean) || [],
        antonyms: document.getElementById(prefix + 'ant')?.value?.split(',').map(s => s.trim()).filter(Boolean) || [],
        examples: document.getElementById(prefix + 'examples')?.value?.split('\n').map(s => s.trim()).filter(Boolean) || [],
        categories: getSelectedCategories(prefix) || [],
        notes: document.getElementById(prefix + 'notes')?.value?.trim() || '',
        favorite: document.getElementById(prefix + 'fav')?.checked || false
    };

    try {
        // Duplicate detection: if a word with same english/turkish exists, warn user
        const existing = findDuplicate(formData.english, formData.turkish);
        if (existing) {
            const open = confirm(`The word "${formData.english}" seems to already exist as "${existing.english} - ${existing.turkish}".\n\nPress OK to view the existing entry, or Cancel to add this as a separate entry.`);
            if (open) {
                // Navigate to dictionary and highlight existing
                navigateTo('dictionary');
                setTimeout(() => {
                    const card = document.querySelector(`[data-testid="card-word-${existing.id}"]`);
                    if (card) {
                        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        card.classList.add('flash-new');
                        setTimeout(() => card.classList.remove('flash-new'), 1800);
                    }
                }, 150);
                return;
            }
        }

        // Add the word
        const newWord = addWord(formData);

        // Show success message with toast
        showToast('Kelimeniz başarıyla eklendi: ' + newWord.english, 'success');

        // Reset form
        event.target.reset();

        // If modal, close it
        if (isModal) {
            closeModal('panel-addWord');
        }

        // Update dictionary view immediately
        navigateTo('dictionary');

        // After a short delay, scroll to and highlight the new word
        setTimeout(() => {
            const wordCard = document.querySelector(`[data-testid="card-word-${newWord.id}"]`);
            if (wordCard) {
                wordCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                wordCard.classList.add('flash-new');
                setTimeout(() => wordCard.classList.remove('flash-new'), 1800);
            }
        }, 100);
    } catch (error) {
        console.error('Error adding word:', error);
        showToast('Kelime eklenirken bir hata oluştu. Lütfen tekrar deneyin.', 'error');
    }
}

function renderAddWord(container) {
    // Mark view so CSS can target page-specific elements
    container.setAttribute('data-view', 'add-word');
    const categories = getAllCategories();

    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-plus-circle"></i>
                Add New Word
            </h1>
            <p class="page-subtitle">Use this form to add a new word to your dictionary.</p>
        </div>

        <div class="card">
            <form id="page-add-word-form" class="word-form" onsubmit="handleAddWordFormSubmit(event)">
                <div class="form-row">
                    <div class="form-group">
                        <label for="page-english">English Word *</label>
                        <input type="text" id="page-english" required data-testid="input-page-english">
                    </div>
                    <div class="form-group">
                        <label for="page-turkish">Turkish Translation *</label>
                        <input type="text" id="page-turkish" required data-testid="input-page-turkish">
                    </div>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label for="page-pron">Pronunciation</label>
                        <input type="text" id="page-pron" placeholder="/prəˌnʌnsiˈeɪʃən/" data-testid="input-page-pron">
                    </div>
                    <div class="form-group">
                        <label for="page-level">Level *</label>
                        <select id="page-level" required data-testid="select-page-level">
                            <option value="A1">A1</option>
                            <option value="A2">A2</option>
                            <option value="B1">B1</option>
                            <option value="B2">B2</option>
                            <option value="C1" selected>C1</option>
                            <option value="C2">C2</option>
                        </select>
                    </div>
                </div>

                <div class="form-group">
                    <label for="page-engExp">English Explanation</label>
                    <textarea id="page-engExp" rows="2" data-testid="input-page-engExp" placeholder="Detailed English definition..."></textarea>
                </div>

                <div class="form-group">
                    <label for="page-turkExp">Turkish Explanation</label>
                    <textarea id="page-turkExp" rows="2" data-testid="input-page-turkExp" placeholder="Türkçe açıklama..."></textarea>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label for="page-syn">Synonyms (comma separated)</label>
                        <input type="text" id="page-syn" data-testid="input-page-syn">
                    </div>
                    <div class="form-group">
                        <label for="page-ant">Antonyms (comma separated)</label>
                        <input type="text" id="page-ant" data-testid="input-page-ant">
                    </div>
                </div>

                <div class="form-group">
                    <label for="page-examples">Example Sentences (one per line)</label>
                    <textarea id="page-examples" rows="3" data-testid="input-page-examples" placeholder="This is an example sentence.\nHere's another example."></textarea>
                </div>
                
                <div class="form-group">
                    <label for="page-notes">Notes</label>
                    <textarea id="page-notes" rows="3" data-testid="input-page-notes" placeholder="Short usage notes, register, collocations..."></textarea>
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label for="page-cats">Categories</label>
                        <div class="custom-select-container" id="page-category-select">
                            <div class="select-header" data-testid="input-page-cats">
                                <div class="selected-categories"></div>
                                <i class="fas fa-chevron-down"></i>
                            </div>
                            <div class="select-dropdown">
                                <div class="search-box">
                                    <input type="text" placeholder="Search categories..." data-testid="page-category-search">
                                </div>
                                <div class="category-list">
                                </div>
                                <div class="dropdown-footer">
                                    <a href="#categories" class="btn-link">
                                        <i class="fas fa-plus"></i>
                                        Manage Categories
                                    </a>
                                </div>
                            </div>
                            <select id="page-cats" multiple style="display: none;" data-testid="input-page-cats"></select>
                        </div>
                    </div>
                    <div class="form-group checkbox-group" style="align-items: center; display:flex; gap: .5rem;">
                        <label style="display:flex; align-items:center; gap: .5rem;">
                            <input type="checkbox" id="page-fav" data-testid="input-page-fav">
                            <span>Mark as Favorite</span>
                        </label>
                    </div>
                </div>

                <div class="form-actions">
                    <button type="button" class="btn-secondary" onclick="navigateTo('dashboard')">Cancel</button>
                    <button type="submit" class="btn-primary">Add Word</button>
                </div>
            </form>
        </div>
    `;

    // Initialize category select
    initializeCategoryDropdown('page');

    // Wire form submit
    const form = document.getElementById('page-add-word-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        const selectedCategories = getSelectedCategories('page');
        const wordData = {
            english: document.getElementById('page-english').value.trim(),
            turkish: document.getElementById('page-turkish').value.trim(),
            pronunciation: document.getElementById('page-pron').value.trim(),
            turkishExplanation: document.getElementById('page-turkExp').value.trim(),
            englishExplanation: document.getElementById('page-engExp').value.trim(),
            synonyms: document.getElementById('page-syn').value.split(',').map(s => s.trim()).filter(Boolean),
            antonyms: document.getElementById('page-ant').value.split(',').map(s => s.trim()).filter(Boolean),
            examples: document.getElementById('page-examples').value.split('\n').map(s => s.trim()).filter(Boolean),
            level: document.getElementById('page-level').value,
            categories: selectedCategories,
            favorite: document.getElementById('page-fav').checked
        };

        if (!wordData.english) {
            showToast('Please enter an English word.', 'warning');
            return;
        }

        if (!wordData.turkish) {
            showToast('Please enter the Turkish translation.', 'warning');
            return;
        }

        if (!wordData.level) {
            showToast('Please select a level for the word.', 'warning');
            return;
        }

        const newWord = addWord(wordData);

        // Immediately persist (don't rely solely on debounced save) and update UI
        updateStats();
        saveState();

        showToast('Word added successfully!', 'success');

        // Re-render dictionary immediately so user sees the new word without reload
        const main = document.getElementById('mainContent');
        renderDictionary(main);

        // Scroll to and briefly highlight the newly added card (if present)
        setTimeout(() => {
            const el = document.querySelector(`[data-testid="card-word-${newWord.id}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('flash-new');
                setTimeout(() => el.classList.remove('flash-new'), 1800);
            }
        }, 120);

        // Navigate to dictionary route (updates URL)
        navigateTo('dictionary');
    });

    // --- AI Assistant helper for page add word ---
    // The helper UI is provided in the collapsible `page-ai-helper` below.
    const pageForm = document.getElementById('page-add-word-form');

    // Wire AI helper events for page
    // Build a collapsible page helper container and prepend it
    const pageHelper = document.createElement('div');
    pageHelper.id = 'page-ai-helper';
    pageHelper.className = 'ai-helper';
    pageHelper.innerHTML = `
        <div style="display:flex; align-items:center; justify-content:space-between;">
            <div style="font-weight:600;">AI Yardımcısı</div>
            <button type="button" id="btn-toggle-ai-page" class="btn-icon" title="Gizle/Aç" style="transform: rotate(0deg); transition: transform .15s;">
                <i class="fas fa-chevron-down"></i>
            </button>
        </div>
        <div style="margin-top:.35rem; display:flex; align-items:center; justify-content:space-between; gap:.5rem;">
            <small style="color:var(--v-text-secondary);">AI'dan yardım almak istiyor musun?</small>
            <div style="margin-left:auto">
                <button type="button" id="btn-open-ai-page-ok" class="btn-secondary" aria-pressed="false">Evet, yardım istiyorum</button>
            </div>
        </div>
        <div id="page-ai-content" style="margin-top:.5rem; display: none;">
            <div class="form-group">
                <label for="page-ai-input">Hangi kelimeyi eklemek istiyorsunuz? (AI yardım için yazıp Enter'a basın)</label>
                <div style="display:flex; gap:.5rem; align-items:center;">
                    <input type="text" id="page-ai-input" placeholder="Örnek: serendipity" style="flex:1; padding:8px;">
                    <button type="button" class="btn-secondary" id="btn-open-chatgpt-page">ChatGPT ile Doldur</button>
                </div>
                <small style="display:block; color:var(--v-text-secondary); margin-top:.4rem;">Butona basınca hazır bir prompt panoya kopyalanır ve ekranda gösterilir. Kopyalayın, ChatGPT'ye yapıştırıp gönderin; gelen JSON'u aşağıya yapıştırarak formu doldurabilirsiniz.</small>
            </div>

            <div class="form-group">
                <label for="page-ai-json">ChatGPT'den gelen JSON'u buraya yapıştırın ve "Uygula"ya basın</label>
                <textarea id="page-ai-json" style="width:100%; min-height:140px; font-family:monospace; padding:8px; margin-top:.4rem;" placeholder='{"english": "...", "turkish": "..."}'></textarea>
                <div style="display:flex; gap:.5rem; margin-top:.5rem;">
                    <button type="button" class="btn-primary" id="btn-apply-ai-json-page">Yapıştır ve Uygula</button>
                    <button type="button" class="btn-secondary" id="btn-clear-ai-json-page">Temizle</button>
                    <div style="flex:1"></div>
                    <small style="color:var(--v-text-secondary);">JSON formatı doğruysa form otomatik doldurulur.</small>
                </div>
            </div>
        </div>
    `;
    if (pageForm) pageForm.prepend(pageHelper);

    // Wire page helper buttons
    // Ensure toggle and OK work immediately after insertion
    const pageToggleBtn = document.getElementById('btn-toggle-ai-page');
    const pageOkBtn = document.getElementById('btn-open-ai-page-ok');
    const pageContent = document.getElementById('page-ai-content');
    if (pageToggleBtn && pageContent) {
        pageToggleBtn.addEventListener('click', () => {
            const icon = pageToggleBtn.querySelector('i');
            if (pageContent.style.display === 'none') {
                pageContent.style.display = '';
                if (icon) icon.className = 'fas fa-chevron-down';
                pageToggleBtn.style.transform = 'rotate(0deg)';
            } else {
                pageContent.style.display = 'none';
                if (icon) icon.className = 'fas fa-chevron-up';
                pageToggleBtn.style.transform = 'rotate(180deg)';
            }
        });
    }
    if (pageOkBtn && pageContent) {
        pageOkBtn.addEventListener('click', () => {
            const icon = pageToggleBtn?.querySelector('i');
            const isClosed = pageContent.style.display === 'none' || pageContent.style.display === '' && getComputedStyle(pageContent).display === 'none';
            if (isClosed) {
                pageContent.style.display = '';
                if (pageToggleBtn) { pageToggleBtn.style.transform = 'rotate(0deg)'; if (icon) icon.className = 'fas fa-chevron-down'; }
                pageOkBtn.textContent = 'Yardımı Kapat';
                pageOkBtn.setAttribute('aria-pressed', 'true');
                setTimeout(() => document.getElementById('page-ai-input')?.focus(), 50);
            } else {
                pageContent.style.display = 'none';
                if (pageToggleBtn) { pageToggleBtn.style.transform = 'rotate(180deg)'; if (icon) icon.className = 'fas fa-chevron-up'; }
                pageOkBtn.textContent = 'Evet, yardım istiyorum';
                pageOkBtn.setAttribute('aria-pressed', 'false');
            }
        });
    }

    document.getElementById('btn-open-chatgpt-page')?.addEventListener('click', () => {
        const w = document.getElementById('page-ai-input')?.value.trim();
        if (!w) { showToast('Lütfen önce bir kelime yazın.', 'warning'); return; }
        const prompt = generateChatGPTPrompt(w);
        showAIPromptModal(prompt);
        copyPromptToClipboard(prompt).then(() => {
            showToast('Prompt panoya kopyalandı. ChatGPT' + "'" + 'ye yapıştırıp gönderin.', 'success');
        }).catch(() => {
            showToast('Prompt panoya kopyalanamadı; lütfen alttaki alandan kopyalayın.', 'warning');
        });
    });

    document.getElementById('page-ai-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btn-open-chatgpt-page')?.click();
        }
    });

    // Wire apply/clear for page json area
    document.getElementById('btn-apply-ai-json-page')?.addEventListener('click', () => {
        const raw = document.getElementById('page-ai-json')?.value || '';
        applyChatGPTJson(raw, 'page-');
    });
    document.getElementById('btn-clear-ai-json-page')?.addEventListener('click', () => {
        const ta = document.getElementById('page-ai-json'); if (ta) ta.value = '';
    });
}

function renderDictionary(container) {
    const words = Object.values(state.words);
    
    // Set the view identifier for the container
    container.setAttribute('data-view', 'dictionary');
    
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-book"></i>
                Dictionary
            </h1>
            <p class="page-subtitle">${words.length} words in your collection</p>
        </div>
        
        <div class="filter-bar">
            <div class="search-box">
                <i class="fas fa-search"></i>
                <input type="search" id="dict-search" placeholder="Search words..." data-testid="input-search-words">
            </div>
            
            <select id="level-filter" data-testid="select-filter-level">
                <option value="">All Levels</option>
                <option value="A1">A1</option>
                <option value="A2">A2</option>
                <option value="B1">B1</option>
                <option value="B2">B2</option>
                <option value="C1">C1</option>
                <option value="C2">C2</option>
            </select>
            
            <select id="category-filter" data-testid="select-filter-category">
                <option value="">All Categories</option>
                ${getAllCategories().map(cat => `<option value="${cat}">${cat}</option>`).join('')}
            </select>
            
            <button class="btn-primary" onclick="openAddWordModal()" data-testid="button-add-new-word">
                <i class="fas fa-plus"></i> Add Word
            </button>
        </div>
        
        <div id="words-list" class="card-grid">
            ${words.length > 0 ? words.map(word => renderWordCard(word)).join('') : `
                <div class="empty-state">
                    <i class="fas fa-book-open"></i>
                    <h3>No words yet</h3>
                    <p>Start building your vocabulary!</p>
                </div>
            `}
        </div>
    `;
    
    // Add event listeners for filters
    document.getElementById('dict-search')?.addEventListener('input', filterWords);
    document.getElementById('level-filter')?.addEventListener('change', filterWords);
    document.getElementById('category-filter')?.addEventListener('change', filterWords);
}

function filterWords() {
    const search = document.getElementById('dict-search')?.value.toLowerCase() || '';
    const level = document.getElementById('level-filter')?.value || '';
    const category = document.getElementById('category-filter')?.value || '';
    
    let filtered = Object.values(state.words);
    
    if (search) {
        filtered = filtered.filter(w => 
            w.english.toLowerCase().includes(search) ||
            w.turkish.toLowerCase().includes(search) ||
            w.englishExplanation.toLowerCase().includes(search)
        );
    }
    
    if (level) {
        filtered = filtered.filter(w => w.level === level);
    }
    
    if (category) {
        filtered = filtered.filter(w => w.categories.includes(category));
    }
    
    const listContainer = document.getElementById('words-list');
    if (listContainer) {
        listContainer.innerHTML = filtered.length > 0 
            ? filtered.map(word => renderWordCard(word)).join('') 
            : '<div class="empty-state"><i class="fas fa-search"></i><h3>No words found</h3></div>';
    }
}

function renderWordCard(word) {
    const correctRate = word.stats.timesTested > 0 
        ? (word.stats.correctCount / word.stats.timesTested * 100) 
        : 0;
    
    return `
        <div class="word-card" data-testid="card-word-${word.id}" onclick="navigateTo('word:${word.id}')">
            <div class="word-header">
                <div>
                    <div class="word-english">${word.english}
                        <button class="btn-play" onclick="playPronunciation('${word.english}', this)" data-testid="button-play-${word.id}">
                            <i class="fas fa-volume-up"></i>
                        </button>
                    </div>
                    ${word.pronunciation ? `
                        <div class="word-pronunciation">
                            ${word.pronunciation}
                        </div>
                    ` : ''}
                </div>
                <div class="word-actions">
                    <button class="btn-icon" onclick="toggleFavorite('${word.id}'); event.stopPropagation(); renderDictionary(document.getElementById('mainContent'));" data-testid="button-favorite-${word.id}">
                        <i class="fas fa-star" style="color: ${word.favorite ? 'var(--v-warning)' : 'var(--v-text-tertiary)'}"></i>
                    </button>
                    <button class="btn-icon" onclick="openEditWordModal('${word.id}'); event.stopPropagation();" data-testid="button-edit-${word.id}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon" onclick="confirmDeleteWord('${word.id}'); event.stopPropagation();" data-testid="button-delete-${word.id}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            
            ${word.turkish ? `<div class="word-turkish">${word.turkish}</div>` : ''}
    
            ${getWordField(word, 'turkishExplanation', 'turkExp', 'turkishExp') ? `
                        <div class="word-explanation">
                            <strong>Türkçe Açıklama:</strong>
                            <p>${getWordField(word, 'turkishExplanation', 'turkExp', 'turkishExp')}</p>
                        </div>
                    ` : ''}
            
            ${word.englishExplanation ? `
                <div class="word-explanation">
                    <strong>English Explanation:</strong>
                    <p>${word.englishExplanation}</p>
                </div>
            ` : ''}
            
            ${word.notes ? `
                <div class="word-notes">
                    <strong>Notes:</strong>
                    <p>${escapeHtml(word.notes)}</p>
                </div>
            ` : ''}

            ${word.examples.length > 0 ? `
                <div class="word-examples">
                    <strong>Examples:</strong>
                    <ul>
                        ${word.examples.map(example => `<li>${example}</li>`).join('')}
                    </ul>
                </div>
            ` : ''}
            
            ${word.synonyms.length > 0 ? `
                <div class="word-synonyms">
                    <strong>Synonyms:</strong> ${word.synonyms.join(', ')}
                </div>
            ` : ''}
            
            ${word.antonyms.length > 0 ? `
                <div class="word-antonyms">
                    <strong>Antonyms:</strong> ${word.antonyms.join(', ')}
                </div>
            ` : ''}
            
            <div class="word-meta">
                <span class="badge badge-level ${word.level}">${word.level}</span>
                ${word.categories.slice(0, 2).map(cat => 
                    `<span class="badge badge-category">${cat}</span>`
                ).join('')}
                ${word.categories.length > 2 ? 
                    `<span class="badge badge-category">+${word.categories.length - 2} more</span>` 
                : ''}
                ${word.stats.learned ? '<span class="badge" style="background: var(--v-success); color: white;">Learned</span>' : ''}
                ${isHardWord(word) ? '<span class="badge" style="background: var(--v-danger); color: white;">Hard</span>' : ''}
            </div>
            
            ${word.stats.timesTested > 0 ? `
                <div class="stats-bar">
                    <div class="stats-bar-fill" style="width: ${correctRate}%"></div>
                </div>
                <div style="font-size: 0.75rem; color: var(--v-text-tertiary); margin-top: 0.25rem;">
                    ${word.stats.correctCount}/${word.stats.timesTested} correct (${Math.round(correctRate)}%)
                </div>
            ` : ''}
        </div>
    `;
}

function renderFavorites(container) {
    const favorites = Object.values(state.words).filter(w => w.favorite);
    
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-star"></i>
                Favorite Words
            </h1>
            <p class="page-subtitle">${favorites.length} words marked as favorites</p>
        </div>
        
        <div class="card-grid">
            ${favorites.length > 0 ? favorites.map(word => renderWordCard(word)).join('') : `
                <div class="empty-state">
                    <i class="fas fa-star"></i>
                    <h3>No favorites yet</h3>
                    <p>Mark words as favorites to see them here.</p>
                </div>
            `}
        </div>
    `;
}

function renderWordDetail(container, id) {
    const word = state.words[id];
    if (!word) {
        container.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Word not found</h1>
                <p class="page-subtitle">The requested word was not found in your dictionary.</p>
            </div>
            <div class="card">
                <p>Try returning to the <a href="#dictionary" onclick="navigateTo('dictionary'); return false;">dictionary</a>.</p>
            </div>
        `;
        return;
    }

    const examplesHtml = (word.examples || []).map(ex => {
        if (typeof ex === 'string') return `<li>${escapeHtml(ex)}</li>`;
        const en = escapeHtml(ex.english || ex.en || '');
        const tr = escapeHtml(ex.turkish || ex.tr || '');
        return `<li><strong>${en}</strong>${tr ? ` — ${tr}` : ''}</li>`;
    }).join('');

    container.innerHTML = `
        <div class="page-header">
            <a href="#dictionary" id="btn-back-dict" class="btn-secondary" style="margin-bottom: 1rem; display: inline-flex; align-items: center; gap: .5rem;" onclick="navigateTo('dictionary'); return false;">
                <i class="fas fa-arrow-left"></i> Back
            </a>
            <h1 class="page-title">${escapeHtml(word.english)}</h1>
            <p class="page-subtitle">${escapeHtml(word.turkish)}</p>
        </div>

        <div class="card">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:1rem;">
                <div style="flex:1;">
                    <div style="display:flex; gap:.5rem; align-items:center;">
                        <h2 style="margin:0;">${escapeHtml(word.english)}</h2>
                        <button class="btn-play" onclick="playPronunciation('${escapeHtml(word.english)}', this)"><i class="fas fa-volume-up"></i></button>
                        <button class="btn-secondary" onclick="copyPermalink('${id}'); event.stopPropagation();">Copy Link</button>
                    </div>

                    ${word.pronunciation ? `<div style="margin-top:.5rem; color: var(--v-text-secondary);">${escapeHtml(word.pronunciation)}</div>` : ''}

                    ${getWordField(word, 'turkishExplanation', 'turkExp', 'turkishExp') ? `
                        <div style="margin-top:1rem;"><strong>Türkçe Açıklama</strong><p>${escapeHtml(getWordField(word, 'turkishExplanation', 'turkExp', 'turkishExp'))}</p></div>
                    ` : ''}

                    ${word.englishExplanation ? `<div style="margin-top:1rem;"><strong>English Explanation</strong><p>${escapeHtml(word.englishExplanation)}</p></div>` : ''}

                    ${examplesHtml ? `<div style="margin-top:1rem;"><strong>Examples</strong><ul>${examplesHtml}</ul></div>` : ''}
                </div>

                <div style="width:260px;">
                    <div style="display:flex; gap:.5rem; margin-bottom:1rem;">
                        <button class="btn-primary" onclick="openEditWordModal('${id}'); event.stopPropagation();">Edit</button>
                        <button class="btn-destructive" onclick="confirmDeleteWord('${id}'); event.stopPropagation();">Delete</button>
                    </div>

                    <div style="margin-top:1rem;">
                        <div><strong>Level</strong>: <span class="badge badge-level ${word.level}">${word.level}</span></div>
                        <div style="margin-top:.5rem;"><strong>Categories</strong>: ${word.categories.map(c => `<span class="badge badge-category">${escapeHtml(c)}</span>`).join(' ')}</div>
                        <div style="margin-top:.5rem;"><strong>Synonyms</strong>: ${word.synonyms.join(', ') || '-'}</div>
                        <div style="margin-top:.5rem;"><strong>Antonyms</strong>: ${word.antonyms.join(', ') || '-'}</div>
                        <div style="margin-top:.5rem;"><strong>Added</strong>: ${formatDate(word.stats.addedAt)}</div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // ensure back button works
    const back = document.getElementById('btn-back-dict');
    if (back) back.addEventListener('click', (e) => { e.preventDefault(); navigateTo('dictionary'); });
}

function renderHardWords(container) {
    const hardWords = Object.values(state.words).filter(w => isHardWord(w));
    
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-exclamation-triangle"></i>
                Hard Words
            </h1>
            <p class="page-subtitle">${hardWords.length} words need extra practice</p>
        </div>
        
        ${hardWords.length >= 5 ? `
            <div style="margin-bottom: 1.5rem;">
                <button class="btn-primary" onclick="openQuizConfig('hard')">
                    <i class="fas fa-graduation-cap"></i> Practice Hard Words
                </button>
            </div>
        ` : ''}
        
        <div class="card-grid">
            ${hardWords.length > 0 ? hardWords.map(word => renderWordCard(word)).join('') : `
                <div class="empty-state">
                    <i class="fas fa-check-circle"></i>
                    <h3>No hard words!</h3>
                    <p>You're doing great! No words are marked as difficult.</p>
                </div>
            `}
        </div>
    `;
}

function renderCategories(container) {
    const categories = getAllCategories();
    
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-tags"></i>
                Categories
            </h1>
            <p class="page-subtitle">${categories.length} categories</p>
        </div>
        
        <div class="card">
            <div style="display:flex; gap: .5rem; align-items:center; margin-bottom: 1rem;">
                <input type="text" id="new-category-input" placeholder="New category name" style="flex:1;" data-testid="input-new-category">
                <button class="btn-primary" id="btn-add-category">Add Category</button>
            </div>
        </div>

        <div class="card-grid">
            ${categories.map(category => {
                const words = getWordsByCategory(category);
                return `
                    <div class="card category-card" style="cursor: pointer;" data-category="${escapeHtml(category)}">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <h3 style="margin:0;"><i class="fas fa-tag"></i> ${escapeHtml(category)}</h3>
                            <div style="display:flex; gap:.5rem;">
                                <button class="btn-icon btn-edit-cat" title="Edit" data-category="${escapeHtml(category)}"><i class="fas fa-edit"></i></button>
                                <button class="btn-icon btn-delete-cat" title="Delete" data-category="${escapeHtml(category)}"><i class="fas fa-trash"></i></button>
                            </div>
                        </div>
                        <p style="color: var(--v-text-secondary); margin-top: 0.5rem;">
                            ${words.length} words
                        </p>
                        ${words.length >= 5 ? `
                            <button class="btn-secondary btn-sm" style="margin-top: 1rem;" onclick="openQuizConfigForCategory('${escapeHtml(category)}'); event.stopPropagation();">
                                <i class="fas fa-play"></i> Practice
                            </button>
                        ` : ''}
                    </div>
                `;
            }).join('')}
            ${categories.length === 0 ? `
                <div class="empty-state">
                    <i class="fas fa-tags"></i>
                    <h3>No categories yet</h3>
                    <p>Add categories to your words to organize them.</p>
                </div>
            ` : ''}
        </div>
    `;
    // Wire add category button
    const addBtn = document.getElementById('btn-add-category');
    const input = document.getElementById('new-category-input');
    if (addBtn && input) {
        addBtn.addEventListener('click', () => {
            const name = input.value.trim();
            if (!name) { showToast('Please provide a category name.', 'warning'); return; }
            const ok = addCategory(name);
            if (ok) {
                input.value = '';
                renderCategories(container);
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addBtn.click();
            }
        });
    }

    // Attach handlers scoped to this container for reliability
    const cardEls = container.querySelectorAll('.category-card');
    cardEls.forEach(card => {
        const cat = card.getAttribute('data-category');
        // Click on the card updates the URL so each category has its own hash
        card.addEventListener('click', () => {
            const hash = `category:${encodeURIComponent(cat)}`;
            navigateTo(hash);
        });

        // Edit button inside the card
        const editBtn = card.querySelector('.btn-edit-cat');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = editBtn.getAttribute('data-category');
                const newName = prompt('Rename category', name);
                if (newName && newName.trim()) {
                    const ok = renameCategory(name, newName.trim());
                    if (ok) renderCategories(container);
                }
            });
        }

        // Delete button inside the card
        const delBtn = card.querySelector('.btn-delete-cat');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = delBtn.getAttribute('data-category');
                const ok = deleteCategory(name);
                if (ok) renderCategories(container);
            });
        }
    });
}

function viewCategory(category) {
    const words = getWordsByCategory(category);
    const container = document.getElementById('mainContent');
    
    container.innerHTML = `
        <div class="page-header">
            <a href="#categories" id="btn-back-categories" class="btn-secondary" style="margin-bottom: 1rem; display: inline-flex; align-items: center; gap: .5rem;">
                <i class="fas fa-arrow-left"></i> Back to Categories
            </a>
            <h1 class="page-title">
                <i class="fas fa-tag"></i>
                ${category}
            </h1>
            <p class="page-subtitle">${words.length} words</p>
        </div>
        
        ${words.length >= 5 ? `
            <div style="margin-bottom: 1.5rem;">
                <button class="btn-primary" onclick="openQuizConfigForCategory('${category}')">
                    <i class="fas fa-graduation-cap"></i> Practice This Category
                </button>
            </div>
        ` : ''}
        
        <div class="card-grid">
            ${words.map(word => renderWordCard(word)).join('')}
        </div>
    `;
    // Ensure back button works
    const backBtn = document.getElementById('btn-back-categories');
    if (backBtn) {
        backBtn.addEventListener('click', () => navigateTo('categories'));
    }
}

function addCategory(name) {
    if (!name || !name.trim()) return false;
    const n = name.trim();
    if (!Array.isArray(state.categories)) state.categories = [];
    if (state.categories.includes(n)) return false; // already exists
    state.categories.push(n);
    saveState();
    showToast(`Category "${n}" added.`, 'success');
    return true;
}

function renameCategory(oldName, newName) {
    if (!oldName || !newName) return false;
    const o = oldName.trim();
    const n = newName.trim();
    if (o === n) return false;
    if (!Array.isArray(state.categories)) state.categories = [];
    if (state.categories.includes(n)) {
        showToast('Category with that name already exists.', 'warning');
        return false;
    }

    // Replace in top-level categories
    state.categories = state.categories.map(c => c === o ? n : c);

    // Replace in words
    Object.values(state.words).forEach(w => {
        if (Array.isArray(w.categories)) {
            w.categories = w.categories.map(c => c === o ? n : c);
        }
    });

    saveState();
    showToast(`Category "${n}" renamed.`, 'success');
    return true;
}

function deleteCategory(name) {
    if (!name) return false;
    const n = name.trim();
    if (!confirm(`Delete category "${n}"? This will remove it from any words.`)) return false;

    // Remove from top-level
    state.categories = (state.categories || []).filter(c => c !== n);

    // Remove from words
    Object.values(state.words).forEach(w => {
        if (Array.isArray(w.categories)) {
            w.categories = w.categories.filter(c => c !== n);
        }
    });

    saveState();
    showToast(`Category "${n}" deleted.`, 'success');
    return true;
}

function renderNotes(container) {
    openNotesDrawer();
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-sticky-note"></i>
                Notes
            </h1>
            <p class="page-subtitle">Your personal learning notes</p>
        </div>
        
        <div class="card">
            <p>Notes are available in the bottom drawer. Click the notes icon or use the drawer below.</p>
            <button class="btn-primary" onclick="openNotesDrawer()">
                <i class="fas fa-sticky-note"></i> Open Notes Drawer
            </button>
        </div>
    `;
}

function renderStatistics(container) {
    const words = Object.values(state.words);
    const levelDistribution = {};
    const categoryDistribution = {};
    
    words.forEach(word => {
        levelDistribution[word.level] = (levelDistribution[word.level] || 0) + 1;
        word.categories.forEach(cat => {
            categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1;
        });
    });
    
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-chart-bar"></i>
                Statistics
            </h1>
            <p class="page-subtitle">Your learning progress and insights</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-primary);">${state.appStats.totalAdded}</div>
                <div class="stat-label">Total Words</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-success);">${state.appStats.totalLearned}</div>
                <div class="stat-label">Learned</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-warning);">${state.appStats.favoritesCount}</div>
                <div class="stat-label">Favorites</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-danger);">${state.appStats.hardCount}</div>
                <div class="stat-label">Hard Words</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-primary);">${state.appStats.streak.current} 🔥</div>
                <div class="stat-label">Current Streak</div>
            </div>
            <div class="stat-card">
                <div class="stat-value" style="color: var(--v-primary);">${state.appStats.streak.best} 🏆</div>
                <div class="stat-label">Best Streak</div>
            </div>
        </div>
        
        <div class="chart-container">
            <h3 class="chart-title">Level Distribution</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 1rem;">
                ${Object.entries(levelDistribution).map(([level, count]) => `
                    <div style="text-align: center; padding: 1rem; background: var(--v-bg-tertiary); border-radius: var(--v-radius-md);">
                        <div style="font-size: 2rem; font-weight: 700; color: var(--v-level-${level.toLowerCase()});">${count}</div>
                        <div style="font-size: 0.85rem; color: var(--v-text-secondary); margin-top: 0.25rem;">${level}</div>
                    </div>
                `).join('')}
            </div>
        </div>
        
        ${Object.keys(categoryDistribution).length > 0 ? `
            <div class="chart-container">
                <h3 class="chart-title">Category Distribution</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem;">
                    ${Object.entries(categoryDistribution)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10)
                        .map(([cat, count]) => `
                        <div style="padding: 1rem; background: var(--v-bg-tertiary); border-radius: var(--v-radius-md);">
                            <div style="font-size: 1.5rem; font-weight: 700;">${count}</div>
                            <div style="font-size: 0.85rem; color: var(--v-text-secondary); margin-top: 0.25rem;">${cat}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
        
        <div class="chart-container">
            <h3 class="chart-title">Quiz History (Last 10)</h3>
            ${state.history.length > 0 ? `
                <div style="overflow-x: auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Score</th>
                                <th>Words</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${state.history.slice(-10).reverse().map(quiz => `
                                <tr>
                                    <td>${formatDate(quiz.date)}</td>
                                    <td>${quiz.score}/20</td>
                                    <td>${quiz.details?.length || 0}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : '<p style="color: var(--v-text-secondary);">No quiz history yet.</p>'}
        </div>
        
        <div style="margin-top: 2rem;">
            <button class="btn-primary" onclick="generatePDFReport()" data-testid="button-generate-pdf">
                <i class="fas fa-file-pdf"></i> Generate PDF Report
            </button>
        </div>
    `;
}

function renderImportExport(container) {
    container.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">
                <i class="fas fa-exchange-alt"></i>
                Import / Export
            </h1>
            <p class="page-subtitle">Backup and restore your vocabulary data</p>
        </div>
        
        <div class="card">
            <h3><i class="fas fa-download"></i> Export Data</h3>
            <p style="color: var(--v-text-secondary); margin: 1rem 0;">
                Download all your words, statistics, and settings as a JSON backup file.
            </p>
            <button class="btn-primary" onclick="exportData()" data-testid="button-export">
                <i class="fas fa-download"></i> Export Backup
            </button>
        </div>
        
        <div class="card" style="margin-top: 1.5rem;">
            <h3><i class="fas fa-upload"></i> Import Data</h3>
            <p style="color: var(--v-text-secondary); margin: 1rem 0;">
                Restore from a backup file. Choose merge to keep existing data or replace to start fresh.
            </p>
            <input type="file" id="import-file" accept=".json" style="display: none;" data-testid="input-import-file">
            <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                <button class="btn-secondary" onclick="document.getElementById('import-file').click()" data-testid="button-choose-file">
                    <i class="fas fa-file"></i> Choose File
                </button>
                <button class="btn-primary" onclick="handleImport('merge')" data-testid="button-import-merge">
                    <i class="fas fa-layer-group"></i> Merge
                </button>
                <button class="btn-destructive" onclick="handleImport('replace')" data-testid="button-import-replace">
                    <i class="fas fa-sync"></i> Replace All
                </button>
            </div>
            <p id="import-filename" style="margin-top: 0.5rem; font-size: 0.85rem; color: var(--v-text-tertiary);"></p>
        </div>
        
        <div class="card" style="margin-top: 1.5rem; border-color: var(--v-danger);">
            <h3 style="color: var(--v-danger);"><i class="fas fa-exclamation-triangle"></i> Danger Zone</h3>
            <p style="color: var(--v-text-secondary); margin: 1rem 0;">
                Clear all data from the application. This action cannot be undone!
            </p>
            <button class="btn-destructive" onclick="confirmClearAll()" data-testid="button-clear-all-data">
                <i class="fas fa-trash"></i> Clear All Data
            </button>
        </div>
    `;
    
    // Setup file input handler
    document.getElementById('import-file').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            document.getElementById('import-filename').textContent = `Selected: ${file.name}`;
        }
    });
}

// ==================== QUIZ FUNCTIONS ====================
function openQuizConfig(source) {
    document.getElementById('quiz-config-modal').classList.add('active');
    document.getElementById('quiz-source').value = source;
    
    if (source === 'category') {
        document.getElementById('category-selector').style.display = 'block';
        document.getElementById('quiz-custom-group').style.display = 'none';
        document.getElementById('quiz-word-count-group').style.display = 'block';
        const select = document.getElementById('quiz-category');
        select.innerHTML = getAllCategories().map(cat => 
            `<option value="${cat}">${cat}</option>`
        ).join('');
    } else if (source === 'custom') {
        document.getElementById('category-selector').style.display = 'none';
        document.getElementById('quiz-custom-group').style.display = 'block';
        document.getElementById('quiz-word-count-group').style.display = 'none';
        populateWordSelectionList();
    } else {
        document.getElementById('category-selector').style.display = 'none';
        document.getElementById('quiz-custom-group').style.display = 'none';
        document.getElementById('quiz-word-count-group').style.display = 'block';
    }
}

function openQuizConfigForCategory(category) {
    document.getElementById('quiz-config-modal').classList.add('active');
    document.getElementById('quiz-source').value = 'category';
    document.getElementById('category-selector').style.display = 'block';
    const select = document.getElementById('quiz-category');
    select.innerHTML = getAllCategories().map(cat => 
        `<option value="${cat}" ${cat === category ? 'selected' : ''}>${cat}</option>`
    ).join('');
}

function populateWordSelectionList(searchQuery = '') {
    const container = document.querySelector('.word-selection-list');
    const allWords = Object.values(state.words);
    const filteredWords = searchQuery ? 
        allWords.filter(w => 
            w.english.toLowerCase().includes(searchQuery.toLowerCase()) ||
            w.turkish.toLowerCase().includes(searchQuery.toLowerCase()) ||
            w.categories.some(c => c.toLowerCase().includes(searchQuery.toLowerCase()))
        ) : allWords;

    container.innerHTML = filteredWords.map(word => `
        <div class="word-selection-item" data-word-id="${word.id}" style="padding: 8px; display: flex; align-items: center; gap: 8px; cursor: pointer; border-bottom: 1px solid var(--v-border-color); user-select: none;">
            <input type="checkbox" style="margin: 0;">
            <div>
                <div style="font-weight: 500;">${escapeHtml(word.english)}</div>
                <div style="color: var(--v-text-secondary); font-size: 0.9em;">
                    ${escapeHtml(word.turkish)}
                    ${word.categories.length ? 
                        `<span style="opacity: 0.7"> • ${word.categories.join(', ')}</span>` 
                        : ''}
                </div>
            </div>
        </div>
    `).join('');

    updateSelectedWordsCount();

    // Add click handlers
    container.querySelectorAll('.word-selection-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.type === 'checkbox') return; // Don't handle checkbox clicks
            const checkbox = item.querySelector('input[type="checkbox"]');
            checkbox.checked = !checkbox.checked;
            updateSelectedWordsCount();
        });
        
        const checkbox = item.querySelector('input[type="checkbox"]');
        checkbox.addEventListener('change', updateSelectedWordsCount);
    });
}

function updateSelectedWordsCount() {
    const count = document.querySelectorAll('.word-selection-item input[type="checkbox"]:checked').length;
    document.getElementById('selected-words-count').textContent = count;
}

// --- ChatGPT prompt helpers ---
function generateChatGPTPrompt(word) {
        return `I will give you a single English word: "${word}".
Please reply ONLY with a single JSON object that strictly follows the schema below. Do not include any extra commentary, explanation, or text — only JSON.

Schema:
{
    "english": string,                    // the headword
    "turkish": string,                    // short Turkish translation
    "pronunciation": string|null,         // IPA or readable pron
    "partOfSpeech": string|null,          // noun / verb / adj / adv / phrase etc.
    "level": string|null,                 // CEFR level (A1..C2) just say level no extra infomation
    "frequencyNote": string|null,         // common / uncommon / rare or frequency note
    "synonyms": [string],
    "antonyms": [string],
    "collocations": [string],             // common collocations (e.g. "make a decision")
    "englishExplanation": string|null,    // clear English definition
    "turkishExplanation": string|null,    // clear Turkish definition
    "notes": string|null,                 // short usage notes, pitfalls, register
    "examples": [                         // provide AT LEAST 4 examples
        {"english": string, "turkish": string, "context": string|null, "register": string|null}
    ]
}

Requirements:
- Provide at least 4 example sentences. Among them include: one formal (e.g., email/report), one informal (casual conversation), one academic/business, and one common everyday usage.
- For each example include an optional "context" (e.g., "email", "casual chat", "news article") and "register" (e.g., "formal", "informal").
- Keep array items as arrays and strings as strings. Use null for empty optional fields.
- DO NOT output anything except the JSON object (no markdown, no explanation).

Word: ${word}`;
}

function showAIPromptModal(prompt) {
    const modal = document.getElementById('ai-prompt-modal');
    const ta = document.getElementById('ai-prompt-text');
    if (!modal || !ta) return;
    ta.value = prompt;
    modal.style.display = 'flex';
    modal.classList.add('active');
}

function hideAIPromptModal() {
    const modal = document.getElementById('ai-prompt-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.classList.remove('active');
}

function copyPromptToClipboard(prompt) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(prompt);
    }
    return Promise.reject(new Error('Clipboard API not available'));
}

function copyPromptAndOpenChatGPT(prompt) {
    // Show the modal with prompt so user always has visible fallback
    showAIPromptModal(prompt);

    // Try to copy silently; if succeeds, open ChatGPT automatically
    copyPromptToClipboard(prompt).then(() => {
        showToast('Prompt panoya kopyalandı. ChatGPT açılıyor — yapıştırıp gönderin.', 'success');
        // attempt to open ChatGPT
        try { window.open('https://chat.openai.com/chat', '_blank'); } catch (e) { /* ignore */ }
    }).catch(() => {
        // If copy fails, user can copy from modal
        showToast('Prompt panoya kopyalanamadı. Lütfen elle kopyalayın veya "Kopyala" butonunu kullanın.', 'warning');
    });
}

function applyChatGPTJson(rawText, prefix = 'f-') {
    if (!rawText || !rawText.trim()) {
        showToast('Lütfen ChatGPT tarafından üretilen JSON metnini yapıştırın.', 'warning');
        return;
    }

    // Extract first JSON object substring between first '{' and last '}'
    const first = rawText.indexOf('{');
    const last = rawText.lastIndexOf('}');
    if (first === -1 || last === -1 || last <= first) {
        showToast('Geçerli JSON bulunamadı. Lütfen yalnızca JSON objesini yapıştırın.', 'error');
        return;
    }

    const jsonStr = rawText.slice(first, last + 1);
    let obj;
    try {
        obj = JSON.parse(jsonStr);
    } catch (err) {
        console.error('JSON parse error', err);
        showToast('JSON ayrıştırılamadı. Lütfen formatı kontrol edin.', 'error');
        return;
    }

    // Map fields to form inputs
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = value ?? '';
        // Trigger input events if needed
        el.dispatchEvent(new Event('input', { bubbles: true }));
    };

    set(prefix + 'english', obj.english || obj.English || '');
    set(prefix + 'turkish', obj.turkish || obj.Turkish || '');
    set(prefix + 'pron', obj.pronunciation || obj.pron || '');
    set(prefix + 'level', obj.level || 'C1');
    set(prefix + 'engExp', obj.englishExplanation || obj.englishExplanation || '');
    // Handle both modal and page IDs for Turkish explanation: modal uses 'f-turkishExp', page uses 'page-turkExp'
    const turkVal = obj.turkishExplanation || obj.turkishExp || obj.turkExp || obj.turkish || '';
    set(prefix + 'turkExp', turkVal);
    set(prefix + 'turkishExp', turkVal);
    set(prefix + 'turkishExplanation', turkVal);

    // Synonyms/antonyms
    if (Array.isArray(obj.synonyms)) set(prefix + 'syn', obj.synonyms.join(', '));
    if (Array.isArray(obj.antonyms)) set(prefix + 'ant', obj.antonyms.join(', '));

    // Notes
    if (obj.notes || obj.note) set(prefix + 'notes', obj.notes || obj.note || '');

    // Examples: convert to lines like "English — Turkish"
    if (Array.isArray(obj.examples)) {
        const lines = obj.examples.map(e => {
            if (typeof e === 'string') return e;
            const en = e.english || e.en || '';
            const tr = e.turkish || e.tr || '';
            return tr ? `${en} — ${tr}` : en;
        });
        set(prefix + 'examples', lines.join('\n'));
    }

    showToast('Form alanları ChatGPT JSON ile dolduruldu. Lütfen kontrol edip Kaydetin.', 'success');
}

function startQuiz() {
    const source = document.getElementById('quiz-source').value;
    const randomize = document.getElementById('quiz-randomize').checked;
    
    const questionTypes = Array.from(document.querySelectorAll('input[type="checkbox"][value]'))
        .filter(cb => cb.checked)
        .map(cb => cb.value);
    
    if (questionTypes.length === 0) {
        showToast('Please select at least one question type.', 'warning');
        return;
    }
    
    // Get words based on source
    let words = [];
    switch (source) {
        case 'all':
            words = Object.values(state.words);
            break;
        case 'due':
            words = getDueWords();
            break;
        case 'favorites':
            words = Object.values(state.words).filter(w => w.favorite);
            break;
        case 'hard':
            words = Object.values(state.words).filter(w => isHardWord(w));
            break;
        case 'category':
            const category = document.getElementById('quiz-category').value;
            words = getWordsByCategory(category);
            break;
        case 'custom':
            const selectedIds = Array.from(document.querySelectorAll('.word-selection-item input[type="checkbox"]:checked'))
                .map(cb => cb.closest('.word-selection-item').getAttribute('data-word-id'));
            words = Object.values(state.words).filter(w => selectedIds.includes(w.id));
            break;
    }
    
    if (words.length < 5) {
        showToast('You need at least 5 words to start a quiz.', 'warning');
        return;
    }
    
    let wordCount = source === 'custom' ? words.length : parseInt(document.getElementById('quiz-word-count').value);

    if (source !== 'custom' && wordCount < 5) {
        showToast('Please select at least 5 words.', 'warning');
        return;
    }
    
    // Shuffle and select words
    const shuffled = [...words].sort(() => Math.random() - 0.5);
    const selectedWords = shuffled.slice(0, Math.min(wordCount, words.length));
    
    // Generate questions
    const questions = [];
    selectedWords.forEach(word => {
        questionTypes.forEach(type => {
            questions.push({ word, type });
        });
    });
    
    if (randomize) {
        questions.sort(() => Math.random() - 0.5);
    }
    
    currentQuiz = {
        id: generateUUID(),
        questions,
        currentIndex: 0,
        answers: [],
        startTime: new Date().toISOString()
    };
    
    document.getElementById('quiz-config-modal').classList.remove('active');
    navigateTo('quiz');
}

function startDailyTest() {
    const dueWords = getDueWords();
    if (dueWords.length < 5) {
        showToast('Not enough words due for review yet.', 'info');
        return;
    }
    
    openQuizConfig('due');
}

function renderQuiz(container) {
    if (!currentQuiz) {
        navigateTo('learn');
        return;
    }
    
    const question = currentQuiz.questions[currentQuiz.currentIndex];
    const progress = currentQuiz.answers.length;
    const total = currentQuiz.questions.length;
    
    container.innerHTML = `
        <div class="quiz-container">
            <div class="quiz-progress">
                ${currentQuiz.questions.map((_, i) => `
                    <div class="progress-dot ${
                        i < progress ? (currentQuiz.answers[i].correct ? 'correct' : 'wrong') : 
                        i === progress ? 'current' : ''
                    }"></div>
                `).join('')}
            </div>
            
            <div class="quiz-question">
                <div class="question-number">Question ${progress + 1} of ${total}</div>
                <div id="question-content"></div>
            </div>
        </div>
    `;
    
    renderQuestion(question, document.getElementById('question-content'));
}

function renderQuestion(question, container) {
    const { word, type } = question;
    
    switch (type) {
        case 'direct':
            renderDirectTranslation(word, container);
            break;
        case 'reverse':
            renderReverseTranslation(word, container);
            break;
        case 'writing':
            renderWriting(word, container);
            break;
        case 'listening':
            renderListening(word, container);
            break;
    }
}

function renderDirectTranslation(word, container) {
    const distractors = generateDistractors(word, 'turkish');
    const options = shuffle([word.turkish, ...distractors]);
    
    container.innerHTML = `
        <div class="question-text">${word.english}</div>
        <p style="color: var(--v-text-secondary); margin-bottom: 2rem;">Select the Turkish translation:</p>
        <div class="quiz-options">
            ${options.map(option => `
                <div class="quiz-option" onclick="selectOption(this, '${word.turkish}')" data-testid="option-${option}">
                    ${option || '(No translation)'}
                </div>
            `).join('')}
        </div>
        <button class="btn-primary btn-block" onclick="submitAnswer()" data-testid="button-submit-answer">
            Submit Answer
        </button>
    `;
}

function renderReverseTranslation(word, container) {
    const distractors = generateDistractors(word, 'english');
    const options = shuffle([word.english, ...distractors]);
    
    container.innerHTML = `
        <div class="question-text">${word.turkish || getWordField(word, 'turkishExplanation', 'turkExp', 'turkishExp')}</div>
        <p style="color: var(--v-text-secondary); margin-bottom: 2rem;">Select the English word:</p>
        <div class="quiz-options">
            ${options.map(option => `
                <div class="quiz-option" onclick="selectOption(this, '${word.english}')" data-testid="option-${option}">
                    ${option}
                </div>
            `).join('')}
        </div>
        <button class="btn-primary btn-block" onclick="submitAnswer()">
            Submit Answer
        </button>
    `;
}

function renderWriting(word, container) {
    const example = word.examples[0] || word.englishExplanation || '';
    const blank = example.replace(new RegExp(word.english, 'gi'), '____');

    // Prepare letters (preserve original characters)
    const target = word.english || '';
    const letters = target.split('');

    // Create shuffled pool
    const pool = shuffle(letters.map((ch, i) => ({ ch, id: `${i}-${Math.random().toString(36).slice(2,8)}` })));

    container.innerHTML = `
        <div class="question-text">Fill in the blank:</div>
        <p style="font-size: 1.1rem; margin: 1.25rem 0; font-style: italic;">"${blank}"</p>

        <div id="writing-slots" class="writing-slots" aria-label="answer slots">
            ${letters.map((ch, idx) => {
                if (/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(ch)) {
                    return `<span class="slot" data-index="${idx}" data-fixed="false"></span>`;
                } else {
                    return `<span class="slot fixed" data-index="${idx}" data-fixed="true">${escapeHtml(ch)}</span>`;
                }
            }).join('')}
        </div>

        <div id="letter-pool" class="letter-pool" aria-label="letter pool">
            ${pool.map(p => `<button class="letter-tile" data-id="${p.id}" data-char="${escapeHtml(p.ch)}">${escapeHtml(p.ch)}</button>`).join('')}
        </div>

        <div style="display:flex; gap: .5rem; margin-top: 1rem;">
            <button class="btn-secondary" id="btn-clear-slots">Clear</button>
            <div style="flex:1"></div>
            <button class="btn-primary btn-block" onclick="submitAnswer()">Submit Answer</button>
        </div>
    `;

    // Wire interactions
    const poolEl = container.querySelector('#letter-pool');
    const slotsEl = container.querySelector('#writing-slots');

    function findNextEmptySlot() {
        return slotsEl.querySelector('.slot:not(.fixed):not([data-filled="true"])');
    }

    poolEl.addEventListener('click', (e) => {
        const btn = e.target.closest('.letter-tile');
        if (!btn) return;
        const char = btn.getAttribute('data-char');
        const id = btn.getAttribute('data-id');
        const slot = findNextEmptySlot();
        if (!slot) return; // no empty slots
        slot.textContent = char;
        slot.setAttribute('data-filled', 'true');
        slot.setAttribute('data-from', id);
        btn.disabled = true;
        btn.classList.add('used');
    });

    slotsEl.addEventListener('click', (e) => {
        const slot = e.target.closest('.slot');
        if (!slot) return;
        if (slot.classList.contains('fixed')) return;
        const fromId = slot.getAttribute('data-from');
        if (fromId) {
            const tile = poolEl.querySelector(`.letter-tile[data-id="${fromId}"]`);
            if (tile) {
                tile.disabled = false;
                tile.classList.remove('used');
            }
        }
        slot.removeAttribute('data-from');
        slot.removeAttribute('data-filled');
        slot.textContent = '';
    });

    container.querySelector('#btn-clear-slots').addEventListener('click', () => {
        slotsEl.querySelectorAll('.slot').forEach(s => {
            if (s.classList.contains('fixed')) return;
            const fromId = s.getAttribute('data-from');
            if (fromId) {
                const tile = poolEl.querySelector(`.letter-tile[data-id="${fromId}"]`);
                if (tile) { tile.disabled = false; tile.classList.remove('used'); }
            }
            s.removeAttribute('data-from');
            s.removeAttribute('data-filled');
            s.textContent = '';
        });
    });
}

function renderListening(word, container) {
    container.innerHTML = `
        <div class="question-text">Listen and type the word:</div>
        <button class="btn-primary" onclick="playPronunciation('${word.english}', this)" style="margin: 2rem auto; display: flex; align-items: center; gap: 0.5rem;" data-testid="button-play-audio">
            <i class="fas fa-volume-up"></i> Play Audio
        </button>
        <input type="text" class="quiz-input" id="listening-answer" placeholder="Type what you hear..." data-testid="input-listening-answer">
        <button class="btn-primary btn-block" onclick="submitAnswer()" style="margin-top: 2rem;">
            Submit Answer
        </button>
    `;
    
    // Auto-play once
    setTimeout(() => playPronunciation(word.english), 500);
}

let selectedAnswer = null;

function selectOption(element, correctAnswer) {
    document.querySelectorAll('.quiz-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    element.classList.add('selected');
    selectedAnswer = element.textContent.trim();
}

function submitAnswer() {
    const question = currentQuiz.questions[currentQuiz.currentIndex];
    const { word, type } = question;
    
    let userAnswer = selectedAnswer;
    
    if (type === 'writing') {
        // assemble from slots
        const slotsEl = document.getElementById('writing-slots');
        if (slotsEl) {
            const slotNodes = Array.from(slotsEl.querySelectorAll('.slot'));
            userAnswer = slotNodes.map(s => s.classList.contains('fixed') ? s.textContent : (s.getAttribute('data-filled') === 'true' ? (s.textContent || '') : '')).join('').trim();
        } else {
            userAnswer = document.getElementById('writing-answer')?.value.trim();
        }
    } else if (type === 'listening') {
        userAnswer = document.getElementById('listening-answer')?.value.trim();
    }
    
    if (!userAnswer) {
        showToast('Please provide an answer.', 'warning');
        return;
    }
    
    let correct = false;
    let correctAnswer = '';
    
    switch (type) {
        case 'direct':
            correctAnswer = word.turkish;
            correct = userAnswer === correctAnswer;
            break;
        case 'reverse':
            correctAnswer = word.english;
            correct = userAnswer === correctAnswer;
            break;
        case 'writing':
        case 'listening':
            correctAnswer = word.english;
            correct = userAnswer.toLowerCase() === correctAnswer.toLowerCase();
            break;
    }
    
    currentQuiz.answers.push({
        wordId: word.id,
        type,
        userAnswer,
        correctAnswer,
        correct
    });
    
    updateWordStats(word.id, correct);
    
    showFeedback(correct, word, correctAnswer);
    selectedAnswer = null;
}

function showFeedback(correct, word, correctAnswer) {
    const feedbackDiv = document.createElement('div');
    feedbackDiv.className = 'quiz-feedback';
    feedbackDiv.innerHTML = `
        <div class="feedback-content">
            <div class="feedback-icon ${correct ? 'correct' : 'wrong'}">
                <i class="fas fa-${correct ? 'check-circle' : 'times-circle'}"></i>
            </div>
            <div class="feedback-title">${correct ? 'Correct!' : 'Incorrect'}</div>
            <div class="feedback-answer">
                <strong>${word.english}</strong>
                ${word.pronunciation ? `<div class="font-mono" style="margin-top: 0.5rem;">${word.pronunciation}</div>` : ''}
                <div style="margin-top: 0.5rem; font-style: italic;">${word.turkish}</div>
                ${word.englishExplanation ? `<div style="margin-top: 0.75rem; font-size: 0.9rem; color: var(--v-text-secondary);">${word.englishExplanation}</div>` : ''}
            </div>
            <button class="btn-secondary" onclick="playPronunciation('${word.english}', this)">
                <i class="fas fa-volume-up"></i> Hear Pronunciation
            </button>
            <button class="btn-primary btn-block" onclick="nextQuestion()" style="margin-top: 1rem;">
                Continue <i class="fas fa-arrow-right"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(feedbackDiv);
    
    // Play pronunciation automatically
    setTimeout(() => playPronunciation(word.english), 300);
}

function nextQuestion() {
    document.querySelector('.quiz-feedback')?.remove();
    
    currentQuiz.currentIndex++;
    
    if (currentQuiz.currentIndex >= currentQuiz.questions.length) {
        showQuizSummary();
    } else {
        renderQuiz(document.getElementById('mainContent'));
    }
}

function showQuizSummary() {
    const correctCount = currentQuiz.answers.filter(a => a.correct).length;
    const total = currentQuiz.answers.length;
    const score = Math.round((correctCount / total) * 100);
    
    // Save to history
    state.history.push({
        quizId: currentQuiz.id,
        date: new Date().toISOString(),
        score: correctCount,
        total: total,
        details: currentQuiz.answers
    });
    
    // Update streak
    updateStreak();
    
    saveState();
    
    // Group by word
    const wordResults = {};
    currentQuiz.answers.forEach(answer => {
        if (!wordResults[answer.wordId]) {
            wordResults[answer.wordId] = { correct: 0, total: 0 };
        }
        wordResults[answer.wordId].total++;
        if (answer.correct) {
            wordResults[answer.wordId].correct++;
        }
    });
    
    const container = document.getElementById('mainContent');
    container.innerHTML = `
        <div class="quiz-summary">
            <h1 style="margin-bottom: 1rem;">Quiz Complete!</h1>
            <div class="summary-score">${correctCount}/${total}</div>
            <div style="font-size: 1.25rem; color: var(--v-text-secondary); margin-bottom: 2rem;">
                ${score}% Correct
            </div>
            
            <div class="summary-details">
                <div class="summary-stat">
                    <div class="summary-stat-value" style="color: var(--v-success);">${correctCount}</div>
                    <div class="summary-stat-label">Correct</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value" style="color: var(--v-danger);">${total - correctCount}</div>
                    <div class="summary-stat-label">Wrong</div>
                </div>
                <div class="summary-stat">
                    <div class="summary-stat-value" style="color: var(--v-primary);">${state.appStats.streak.current} 🔥</div>
                    <div class="summary-stat-label">Streak</div>
                </div>
            </div>
            
            <div class="word-breakdown">
                <h3>Mark Words as Learned</h3>
                <p style="color: var(--v-text-secondary); margin-bottom: 1rem;">
                    Select words you feel confident about:
                </p>
                ${Object.entries(wordResults).map(([wordId, result]) => {
                    const word = state.words[wordId];
                    if (!word) return '';
                    return `
                        <div class="breakdown-item">
                            <label>
                                <input type="checkbox" ${word.stats.learned ? 'checked' : ''} 
                                    onchange="toggleLearned('${wordId}')" data-testid="checkbox-learned-${wordId}">
                                <span>
                                    <strong>${word.english}</strong> - ${word.turkish}
                                    <span style="margin-left: 0.5rem; color: var(--v-text-tertiary);">
                                        (${result.correct}/${result.total})
                                    </span>
                                </span>
                            </label>
                            ${result.correct < result.total ? 
                                `<span class="badge" style="background: var(--v-danger); color: white;">Review</span>` 
                            : ''}
                        </div>
                    `;
                }).join('')}
            </div>
            
            <div style="display: flex; gap: 1rem; margin-top: 2rem; flex-wrap: wrap; justify-content: center;">
                <button class="btn-secondary" onclick="exportQuizPDF()" data-testid="button-export-quiz-pdf">
                    <i class="fas fa-file-pdf"></i> Export as PDF
                </button>
                <button class="btn-primary" onclick="startQuiz()" data-testid="button-retake-quiz">
                    <i class="fas fa-redo"></i> Take Another Quiz
                </button>
                <button class="btn-primary" onclick="retakeSameQuiz()" data-testid="button-retake-same">
                    <i class="fas fa-redo-alt"></i> Retake Same Quiz
                </button>
                <button class="btn-primary" onclick="currentQuiz = null; navigateTo('dashboard')" data-testid="button-back-dashboard">
                    <i class="fas fa-home"></i> Back to Dashboard
                </button>
            </div>
        </div>
    `;
}

function retakeSameQuiz() {
    if (!currentQuiz || !currentQuiz.questions || currentQuiz.questions.length === 0) {
        showToast('No quiz to retake.', 'warning');
        return;
    }

    // Reset progress but keep same questions and order
    currentQuiz.currentIndex = 0;
    currentQuiz.answers = [];
    currentQuiz.startTime = new Date().toISOString();

    // Remove any feedback overlays
    document.querySelectorAll('.quiz-feedback').forEach(el => el.remove());

    // Clear any selected answer state
    selectedAnswer = null;

    // Render the quiz view again
    navigateTo('quiz');
    renderQuiz(document.getElementById('mainContent'));
}

function toggleLearned(wordId) {
    if (state.words[wordId]) {
        state.words[wordId].stats.learned = !state.words[wordId].stats.learned;
        updateStats();
        debouncedSaveState();
    }
}

function updateStreak() {
    const today = new Date().toDateString();
    const lastActive = state.appStats.streak.lastActive 
        ? new Date(state.appStats.streak.lastActive).toDateString() 
        : null;
    
    if (lastActive === today) {
        // Already completed today
        return;
    }
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toDateString();
    
    if (lastActive === yesterdayStr) {
        // Continuing streak
        state.appStats.streak.current++;
    } else if (!lastActive || lastActive !== yesterdayStr) {
        // New streak or broken streak
        state.appStats.streak.current = 1;
    }
    
    state.appStats.streak.lastActive = new Date().toISOString();
    state.appStats.streak.best = Math.max(
        state.appStats.streak.best,
        state.appStats.streak.current
    );
    
    updateStats();
}

function generateDistractors(word, field) {
    const allWords = Object.values(state.words).filter(w => w.id !== word.id);
    const sameLevel = allWords.filter(w => w.level === word.level);
    const pool = sameLevel.length >= 3 ? sameLevel : allWords;
    
    const shuffled = pool.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3).map(w => w[field] || w.english);
}

function shuffle(array) {
    return [...array].sort(() => Math.random() - 0.5);
}

// ==================== MODAL FUNCTIONS ====================
// Category Dropdown Functions
function toggleCategoryDropdown(prefix) {
    const dropdown = document.getElementById(`${prefix}-cats-dropdown`);
    dropdown.classList.toggle('active');
    
    if (dropdown.classList.contains('active')) {
        const searchInput = dropdown.querySelector('input');
        if (searchInput) searchInput.focus();
    }
}

function updateSelectedCategories(prefix) {
    const container = document.getElementById(`${prefix}-category-select`);
    if (!container) return;

    const selectedContainer = container.querySelector('.selected-categories');
    const selectedOptions = container.querySelectorAll('.category-option.selected');
    
    if (!selectedContainer) return;
    
    selectedContainer.innerHTML = Array.from(selectedOptions)
        .map(option => {
            const value = option.getAttribute('data-value');
            const text = option.querySelector('span').textContent;
            return `
                <div class="category-tag">
                    <span>${text}</span>
                    <i class="fas fa-times remove" onclick="removeCategory('${prefix}', '${value}')"></i>
                </div>
            `;
        }).join('');
}

function removeCategory(prefix, value) {
    const container = document.getElementById(`${prefix}-category-select`);
    if (!container) return;

    const option = container.querySelector(`.category-option[data-value="${value}"]`);
    if (option) {
        option.classList.remove('selected');
        updateSelectedCategories(prefix);
    }
}

function getSelectedCategories(prefix) {
    const container = document.getElementById(`${prefix}-category-select`);
    if (!container) return [];

    return Array.from(container.querySelectorAll('.category-option.selected'))
        .map(option => option.getAttribute('data-value'));
}

function toggleCategory(prefix, value) {
    const container = document.getElementById(`${prefix}-category-select`);
    if (!container) return;

    const option = container.querySelector(`.category-option[data-value="${value}"]`);
    if (!option) return;

    if (option.classList.contains('selected')) {
        option.classList.remove('selected');
    } else {
        option.classList.add('selected');
    }
    updateSelectedCategories(prefix);
}

function initializeCategoryDropdown(prefix) {
    const categories = getAllCategories();
    const container = document.getElementById(`${prefix}-category-select`);
    if (!container) {
        console.error(`Category container ${prefix}-category-select not found`);
        return;
    }
    
    const list = container.querySelector('.category-list');
    if (!list) {
        console.error('Category list not found');
        return;
    }
    
    // Clear existing content
    list.innerHTML = '';
    
    // Add categories to the list
    if (categories.length === 0) {
        list.innerHTML = `
            <div class="category-empty" style="padding:12px; color:var(--v-text-secondary);">
                No categories yet. <a href="#categories" class="btn-link">Create one</a>
            </div>
        `;
    } else {
        categories.forEach(category => {
            const safe = escapeHtml(category);
            list.insertAdjacentHTML('beforeend', `
                <div class="category-option" data-value="${safe}">
                    <i class="fas fa-check"></i>
                    <span>${safe}</span>
                </div>
            `);
        });

        // Add click handlers (delegated to list for robustness)
        list.addEventListener('click', (ev) => {
            const opt = ev.target.closest('.category-option');
            if (!opt) return;
            const value = opt.getAttribute('data-value');
            toggleCategory(prefix, value);
        });

        // Add search handler (use data-testid or text input inside container)
        const searchInput = container.querySelector('input[data-testid$="-category-search"]') || container.querySelector('input[type="text"]');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                list.querySelectorAll('.category-option').forEach(option => {
                    const text = option.querySelector('span').textContent.toLowerCase();
                    option.style.display = text.includes(query) ? '' : 'none';
                });
            });
        }
    }

    // Initialize header click handler
    const header = container.querySelector('.select-header');
    if (header) {
        header.addEventListener('click', () => {
            const dropdown = container.querySelector('.select-dropdown');
            if (dropdown) {
                // Close all other dropdowns first
                document.querySelectorAll('.select-dropdown.active').forEach(d => {
                    if (d !== dropdown) d.classList.remove('active');
                });
                dropdown.classList.toggle('active');
                if (dropdown.classList.contains('active')) {
                    searchInput?.focus();
                }
            }
        });
    }

    // Click outside to close
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            container.querySelector('.select-dropdown')?.classList.remove('active');
        }
    });
}

function openAddWordModal() {
    // Reset form and prepare modal
    const modalForm = document.getElementById('word-form');
    const modalPanel = document.getElementById('panel-addWord');
    
    if (!modalForm || !modalPanel) {
        showToast('Modal form not found', 'error');
        return;
    }
    
    // Reset form state
    document.getElementById('word-id').value = '';
    modalForm.reset();
    document.getElementById('modal-title').textContent = 'Add New Word';
    
    // Initialize category dropdown
    initializeCategoryDropdown('f');
    
    // Show modal and focus first field
    modalPanel.classList.add('active');
    setTimeout(() => document.getElementById('f-english')?.focus(), 100);
}

function openEditWordModal(id) {
    const word = state.words[id];
    if (!word) return;
    
    document.getElementById('word-id').value = id;
    document.getElementById('f-english').value = word.english;
    document.getElementById('f-turkish').value = word.turkish;
    document.getElementById('f-pron').value = word.pronunciation;
    document.getElementById('f-turkishExp').value = getWordField(word, 'turkishExplanation', 'turkExp', 'turkishExp');
    document.getElementById('f-engExp').value = word.englishExplanation;
    document.getElementById('f-syn').value = word.synonyms.join(', ');
    document.getElementById('f-ant').value = word.antonyms.join(', ');
    document.getElementById('f-examples').value = word.examples.join('\n');
    document.getElementById('f-level').value = word.level;
    document.getElementById('f-notes').value = word.notes || '';
    
    // Initialize categories
    initializeCategoryDropdown('f');
    const categoryOptions = document.querySelectorAll('#f-category-select .category-option');
    categoryOptions.forEach(option => {
        const value = option.getAttribute('data-value');
        if (word.categories.includes(value)) {
            option.classList.add('selected');
        }
    });
    updateSelectedCategories('f');
    
    document.getElementById('f-fav').checked = word.favorite;
    
    document.getElementById('modal-title').textContent = 'Edit Word';
    document.getElementById('panel-addWord').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function confirmDeleteWord(id) {
    const word = state.words[id];
    if (!word) return;
    
    if (confirm(`"${word.english}" kelimesini silmek istediğinizden emin misiniz?`)) {
        // Get current view before deleting
        const currentView = document.getElementById('mainContent').getAttribute('data-view');
        
        // Delete the word
        if (deleteWord(id)) {
            showToast('Kelime başarıyla silindi: ' + word.english, 'success');
            
            // Re-render the current view
            const mainContent = document.getElementById('mainContent');
            switch (currentView) {
                case 'dictionary':
                    renderDictionary(mainContent);
                    break;
                case 'favorites':
                    renderFavorites(mainContent);
                    break;
                case 'hard':
                    renderHardWords(mainContent);
                    break;
                default:
                    handleRoute();
            }
        } else {
            showToast('Kelime silinirken bir hata oluştu', 'error');
        }
    }
}

function confirmClearAll() {
    showConfirmModal(
        'Clear All Data',
        'This will permanently delete all your words, statistics, and settings. Type DELETE to confirm.',
        true,
        () => {
            state = {
                meta: {
                    version: '1.0',
                    createdAt: new Date().toISOString(),
                    lastSync: new Date().toISOString()
                },
                settings: {
                    theme: state.settings.theme, // Preserve theme
                    notificationHour: '20:00',
                    notificationEnabled: false,
                    dailyTestTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                },
                words: {},
                history: [],
                appStats: {
                    totalAdded: 0,
                    totalLearned: 0,
                    favoritesCount: 0,
                    hardCount: 0,
                    streak: { current: 0, best: 0, lastActive: null }
                }
            };
            saveState();
            updateStats();
            navigateTo('dashboard');
            showToast('All data cleared.', 'success');
        }
    );
}

function showConfirmModal(title, message, requireTyping, onConfirm) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    
    const input = document.getElementById('confirm-input');
    if (requireTyping) {
        input.style.display = 'block';
        input.value = '';
    } else {
        input.style.display = 'none';
    }
    
    const okBtn = document.getElementById('btn-confirm-ok');
    okBtn.onclick = () => {
        if (requireTyping && input.value !== 'DELETE') {
            showToast('Please type DELETE to confirm.', 'warning');
            return;
        }
        closeModal('confirm-modal');
        onConfirm();
    };
    
    document.getElementById('confirm-modal').classList.add('active');
}

// ==================== NOTIFICATIONS ====================
function setupNotifications() {
    if (!('Notification' in window)) {
        console.log('This browser does not support notifications');
        return;
    }
    
    if (state.settings.notificationEnabled && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                showToast('Notifications enabled! You\'ll receive daily reminders.', 'success');
            }
        });
    }
    
    // Start checking for daily reminders
    if (notificationCheckInterval) {
        clearInterval(notificationCheckInterval);
    }
    
    notificationCheckInterval = setInterval(checkDailyReminder, 60000); // Check every minute
}

function checkDailyReminder() {
    if (!state.settings.notificationEnabled) return;
    
    const now = new Date();
    
    // Check if snoozed
    if (snoozedUntil && now < snoozedUntil) {
        return;
    }
    
    const [hour, minute] = state.settings.notificationHour.split(':').map(Number);
    const targetTime = new Date();
    targetTime.setHours(hour, minute, 0, 0);
    
    const timeDiff = Math.abs(now - targetTime);
    
    // If within 5 minutes of target time and haven't tested today
    if (timeDiff < 5 * 60 * 1000) {
        const lastActive = state.appStats.streak.lastActive 
            ? new Date(state.appStats.streak.lastActive).toDateString()
            : null;
        const today = now.toDateString();
        
        if (lastActive !== today) {
            showDailyReminder();
        }
    }
}

function showDailyReminder() {
    document.getElementById('daily-reminder').style.display = 'block';
    
    if (Notification.permission === 'granted') {
        new Notification('VocabMaster Daily Test', {
            body: 'Time for your daily vocabulary test! Keep your streak going.',
            icon: '/favicon.png'
        });
    }
}

function snoozeReminder() {
    snoozedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    document.getElementById('daily-reminder').style.display = 'none';
    showToast('Reminder snoozed for 1 hour.', 'info');
}

function takeTestNow() {
    document.getElementById('daily-reminder').style.display = 'none';
    startDailyTest();
}

// ==================== NOTES ====================
let notesCache = [];
let selectedNoteId = null;

function _getNotesFromStorage() {
    try {
        const raw = localStorage.getItem(NOTES_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'string') {
            return [{
                id: generateUUID(),
                title: 'Note 1',
                content: parsed,
                updatedAt: new Date().toISOString()
            }];
        }
        if (Array.isArray(parsed)) return parsed;
        return [];
    } catch (err) {
        console.error('Failed to read notes from storage:', err);
        return [];
    }
}

function _saveNotesToStorage(notes) {
    try {
        localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
    } catch (err) {
        console.error('Failed to save notes to storage:', err);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderNotesList(filter = '') {
    const list = document.getElementById('notes-list-items');
    if (!list) return;
    const items = notesCache
        .filter(n => !filter || n.title.toLowerCase().includes(filter.toLowerCase()) || n.content.toLowerCase().includes(filter.toLowerCase()))
        .map(n => {
            const active = n.id === selectedNoteId ? 'active' : '';
            return `
                <li class="note-item ${active}" data-id="${n.id}">
                    <div class="note-title">${escapeHtml(n.title || 'Untitled')}</div>
                    <div class="note-meta">${formatDate(n.updatedAt)}</div>
                </li>
            `;
        }).join('');
    list.innerHTML = items || '<li class="note-empty">No notes yet. Click + to add one.</li>';
}

function loadSelectedNoteToEditor() {
    const note = notesCache.find(n => n.id === selectedNoteId) || notesCache[0] || null;
    if (!note) {
        document.getElementById('note-title').value = '';
        document.getElementById('notes-editor').value = '';
        return;
    }
    selectedNoteId = note.id;
    document.getElementById('note-title').value = note.title || '';
    document.getElementById('notes-editor').value = note.content || '';
    renderNotesList(document.getElementById('note-search')?.value || '');
}

function selectNoteById(id) {
    if (!id) return;
    selectedNoteId = id;
    loadSelectedNoteToEditor();
}

function addNewNote() {
    const newNote = {
        id: generateUUID(),
        title: `Note ${notesCache.length + 1}`,
        content: '',
        updatedAt: new Date().toISOString()
    };
    notesCache.unshift(newNote);
    _saveNotesToStorage(notesCache);
    selectedNoteId = newNote.id;
    renderNotesList();
    loadSelectedNoteToEditor();
}

function deleteNoteById(id) {
    if (!id) return;
    const idx = notesCache.findIndex(n => n.id === id);
    if (idx === -1) return;
    if (!confirm('Delete this note?')) return;
    notesCache.splice(idx, 1);
    _saveNotesToStorage(notesCache);
    selectedNoteId = notesCache[0] ? notesCache[0].id : null;
    renderNotesList();
    loadSelectedNoteToEditor();
}

const _debouncedSaveNote = debounce(() => {
    const note = notesCache.find(n => n.id === selectedNoteId);
    if (!note) return;
    note.title = document.getElementById('note-title').value || note.title;
    note.content = document.getElementById('notes-editor').value || '';
    note.updatedAt = new Date().toISOString();
    _saveNotesToStorage(notesCache);
    renderNotesList(document.getElementById('note-search')?.value || '');
}, 500);

function openNotesDrawer() {
    const drawer = document.getElementById('notesDrawer');
    drawer.classList.add('active');

    // Load notes
    notesCache = _getNotesFromStorage();
    if (!notesCache || notesCache.length === 0) {
        notesCache = [{ id: generateUUID(), title: 'Note 1', content: '', updatedAt: new Date().toISOString() }];
        _saveNotesToStorage(notesCache);
    }
    selectedNoteId = notesCache[0].id;
    renderNotesList();
    loadSelectedNoteToEditor();

    // Wire up UI handlers (idempotent)
    const list = document.getElementById('notes-list-items');
    list.onclick = (e) => {
        const li = e.target.closest('.note-item');
        if (!li) return;
        const id = li.getAttribute('data-id');
        selectNoteById(id);
    };

    document.getElementById('btn-add-note').onclick = addNewNote;
    document.getElementById('btn-delete-note').onclick = () => deleteNoteById(selectedNoteId);
    document.getElementById('note-title').addEventListener('input', _debouncedSaveNote);
    document.getElementById('notes-editor').addEventListener('input', _debouncedSaveNote);
    const search = document.getElementById('note-search');
    if (search) {
        search.addEventListener('input', (ev) => renderNotesList(ev.target.value));
    }
}

function closeNotesDrawer() {
    document.getElementById('notesDrawer').classList.remove('active');
}

function openNotesInNewWindow() {
    const note = notesCache.find(n => n.id === selectedNoteId) || { title: '', content: '' };
    const newWindow = window.open('', 'VocabMaster Notes', 'width=700,height=500');
    newWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>VocabMaster Note - ${escapeHtml(note.title || 'Note')}</title>
            <meta charset="utf-8" />
            <style>
                body { font-family: 'Inter', sans-serif; padding: 20px; background: #f8f9fa; }
                h2 { margin-top: 0; }
                textarea { width: 100%; min-height: 300px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; font-family: inherit; font-size: 14px; resize: vertical; }
                input { width: 100%; padding: 10px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #ddd; }
            </style>
        </head>
        <body>
            <h2>${escapeHtml(note.title || 'Note')}</h2>
            <textarea id="notes">${escapeHtml(note.content || '')}</textarea>
            <script>
                const textarea = document.getElementById('notes');
                textarea.addEventListener('input', () => {
                    try { window.opener && window.opener.postMessage({ type: 'notes-updated', content: textarea.value }, '*'); } catch(e) {}
                });
            </script>
        </body>
        </html>
    `);
}

// Listen for updates from the notes popup window and persist them
window.addEventListener('message', (ev) => {
    if (!ev.data || ev.data.type !== 'notes-updated') return;
    const note = notesCache.find(n => n.id === selectedNoteId);
    if (!note) return;
    note.content = ev.data.content;
    note.updatedAt = new Date().toISOString();
    _saveNotesToStorage(notesCache);
    // if drawer open, update editor and list
    const editor = document.getElementById('notes-editor');
    if (editor) editor.value = note.content;
    renderNotesList(document.getElementById('note-search')?.value || '');
});

// ==================== PDF EXPORT ====================
function generatePDFReport() {
    if (typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
        showToast('PDF library not loaded. Please refresh and try again.', 'error');
        return;
    }
    
    showLoading();
    
    setTimeout(() => {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            let y = 20;
            
            // Title
            doc.setFontSize(20);
            doc.text('VocabMaster Progress Report', 20, y);
            y += 15;
            
            // Date
            doc.setFontSize(10);
            doc.text(`Generated: ${new Date().toLocaleString()}`, 20, y);
            y += 10;
            
            // Statistics
            doc.setFontSize(16);
            doc.text('Statistics', 20, y);
            y += 10;
            
            doc.setFontSize(11);
            doc.text(`Total Words: ${state.appStats.totalAdded}`, 20, y);
            y += 7;
            doc.text(`Learned: ${state.appStats.totalLearned}`, 20, y);
            y += 7;
            doc.text(`Favorites: ${state.appStats.favoritesCount}`, 20, y);
            y += 7;
            doc.text(`Hard Words: ${state.appStats.hardCount}`, 20, y);
            y += 7;
            doc.text(`Current Streak: ${state.appStats.streak.current} days`, 20, y);
            y += 7;
            doc.text(`Best Streak: ${state.appStats.streak.best} days`, 20, y);
            y += 15;
            
            // Learned Words
            const learnedWords = Object.values(state.words).filter(w => w.stats.learned);
            if (learnedWords.length > 0) {
                doc.setFontSize(16);
                doc.text('Learned Words', 20, y);
                y += 10;
                
                doc.setFontSize(10);
                learnedWords.slice(0, 20).forEach(word => {
                    if (y > 270) {
                        doc.addPage();
                        y = 20;
                    }
                    doc.text(`• ${word.english} - ${word.turkish}`, 25, y);
                    y += 6;
                });
                
                if (learnedWords.length > 20) {
                    doc.text(`... and ${learnedWords.length - 20} more`, 25, y);
                    y += 6;
                }
                y += 10;
            }
            
            // Hard Words
            const hardWords = Object.values(state.words).filter(w => isHardWord(w));
            if (hardWords.length > 0) {
                if (y > 250) {
                    doc.addPage();
                    y = 20;
                }
                
                doc.setFontSize(16);
                doc.text('Hard Words (Need Practice)', 20, y);
                y += 10;
                
                doc.setFontSize(10);
                hardWords.slice(0, 20).forEach(word => {
                    if (y > 270) {
                        doc.addPage();
                        y = 20;
                    }
                    doc.text(`• ${word.english} - ${word.turkish} (Score: ${word.stats.difficultyScore})`, 25, y);
                    y += 6;
                });
                
                if (hardWords.length > 20) {
                    doc.text(`... and ${hardWords.length - 20} more`, 25, y);
                }
            }
            
            // Footer
            const pageCount = doc.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.setFontSize(8);
                doc.text(`Page ${i} of ${pageCount} | VocabMaster v${state.meta.version}`, 
                    20, doc.internal.pageSize.height - 10);
            }
            
            doc.save(`vocabmaster_report_${new Date().toISOString().split('T')[0]}.pdf`);
            showToast('PDF report generated successfully!', 'success');
        } catch (error) {
            console.error('PDF generation error:', error);
            showToast('Error generating PDF. Please try again.', 'error');
        } finally {
            hideLoading();
        }
    }, 100);
}

function exportQuizPDF() {
    if (!currentQuiz || typeof window.jspdf === 'undefined' || !window.jspdf.jsPDF) {
        showToast('Unable to export quiz results.', 'error');
        return;
    }
    
    showLoading();
    
    setTimeout(() => {
        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            
            const correctCount = currentQuiz.answers.filter(a => a.correct).length;
            const total = currentQuiz.answers.length;
            
            let y = 20;
            
            doc.setFontSize(20);
            doc.text('Quiz Results', 20, y);
            y += 15;
            
            doc.setFontSize(12);
            doc.text(`Score: ${correctCount}/${total} (${Math.round(correctCount/total*100)}%)`, 20, y);
            y += 10;
            doc.text(`Date: ${new Date().toLocaleString()}`, 20, y);
            y += 15;
            
            doc.setFontSize(14);
            doc.text('Detailed Results:', 20, y);
            y += 10;
            
            doc.setFontSize(10);
            currentQuiz.answers.forEach((answer, i) => {
                if (y > 270) {
                    doc.addPage();
                    y = 20;
                }
                
                const word = state.words[answer.wordId];
                const status = answer.correct ? '✓' : '✗';
                doc.text(`${i + 1}. ${status} ${word.english} - ${word.turkish}`, 20, y);
                y += 6;
            });
            
            doc.save(`quiz_results_${new Date().toISOString().split('T')[0]}.pdf`);
            showToast('Quiz results exported!', 'success');
        } catch (error) {
            console.error('PDF export error:', error);
            showToast('Error exporting quiz results.', 'error');
        } finally {
            hideLoading();
        }
    }, 100);
}

// ==================== THEME ====================
function toggleTheme() {
    state.settings.theme = state.settings.theme === 'light' ? 'dark' : 'light';
    applyTheme();
    saveState();
}

function applyTheme() {
    document.body.classList.toggle('dark', state.settings.theme === 'dark');
    const icon = document.querySelector('#btn-theme-toggle i');
    if (icon) {
        icon.className = state.settings.theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
    }
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', () => {
    // Load state
    loadState();
    applyTheme();
    setupNotifications();

    // Wire up Add Word Modal close button
    document.querySelector('#panel-addWord .btn-close')?.addEventListener('click', () => {
        closeModal('panel-addWord');
    });

    // AI helper in modal: wire events
    document.getElementById('btn-open-chatgpt-modal')?.addEventListener('click', () => {
        const w = document.getElementById('f-ai-input')?.value.trim();
        if (!w) { showToast('Lütfen önce bir kelime yazın.', 'warning'); return; }
        const prompt = generateChatGPTPrompt(w);
        // Show prompt in modal and copy to clipboard, but do not open ChatGPT automatically
        showAIPromptModal(prompt);
        copyPromptToClipboard(prompt).then(() => {
            showToast('Prompt panoya kopyalandı. ChatGPT' + "'" + 'ye yapıştırıp gönderin.', 'success');
        }).catch(() => {
            showToast('Prompt panoya kopyalanamadı; lütfen alttaki alandan kopyalayın.', 'warning');
        });
    });

    document.getElementById('f-ai-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('btn-open-chatgpt-modal')?.click();
        }
    });

    // Wire modal apply/clear for pasted JSON
    document.getElementById('btn-apply-ai-json')?.addEventListener('click', () => {
        const raw = document.getElementById('f-ai-json')?.value || '';
        applyChatGPTJson(raw, 'f-');
    });
    document.getElementById('btn-clear-ai-json')?.addEventListener('click', () => {
        const ta = document.getElementById('f-ai-json'); if (ta) ta.value = '';
    });

    // Wire AI prompt modal buttons
    document.getElementById('btn-copy-ai-prompt')?.addEventListener('click', () => {
        const prompt = document.getElementById('ai-prompt-text')?.value || '';
        if (!prompt) return;
        copyPromptToClipboard(prompt).then(() => {
            showToast('Prompt panoya kopyalandı.', 'success');
        }).catch(() => {
            // final fallback: select textarea so user can Ctrl+C
            const ta = document.getElementById('ai-prompt-text');
            ta.focus(); ta.select();
            showToast('Kopyalama başarısız — lütfen metni seçip kopyalayın.', 'warning');
        });
    });

    document.getElementById('btn-open-chatgpt-from-prompt')?.addEventListener('click', () => {
        try { window.open('https://chat.openai.com/chat', '_blank'); } catch (e) { /* ignore */ }
        showToast('ChatGPT açıldı — promptu yapıştırıp gönderin.', 'info');
    });

    document.getElementById('btn-close-ai-prompt')?.addEventListener('click', hideAIPromptModal);
    document.getElementById('btn-close-ai-prompt-bottom')?.addEventListener('click', hideAIPromptModal);

    // Toggle handlers for modal/page AI helper collapse
    document.getElementById('btn-toggle-ai-modal')?.addEventListener('click', () => {
        const content = document.getElementById('modal-ai-content');
        const btn = document.getElementById('btn-toggle-ai-modal');
        if (!content || !btn) return;
        const icon = btn.querySelector('i');
        if (content.style.display === 'none') {
            content.style.display = '';
            if (icon) icon.className = 'fas fa-chevron-down';
            btn.style.transform = 'rotate(0deg)';
        } else {
            content.style.display = 'none';
            if (icon) icon.className = 'fas fa-chevron-up';
            btn.style.transform = 'rotate(180deg)';
        }
    });

    // Modal open/toggle button: toggle content and update label
    document.getElementById('btn-open-ai-modal-ok')?.addEventListener('click', () => {
        const content = document.getElementById('modal-ai-content');
        const toggleBtn = document.getElementById('btn-toggle-ai-modal');
        const openBtn = document.getElementById('btn-open-ai-modal-ok');
        if (!content || !openBtn) return;
        const icon = toggleBtn?.querySelector('i');
        const isClosed = content.style.display === 'none' || content.style.display === '' && getComputedStyle(content).display === 'none';

        if (isClosed) {
            content.style.display = '';
            if (toggleBtn) { toggleBtn.style.transform = 'rotate(0deg)'; if (icon) icon.className = 'fas fa-chevron-down'; }
            openBtn.textContent = 'Yardımı Kapat';
            openBtn.setAttribute('aria-pressed', 'true');
            setTimeout(() => document.getElementById('f-ai-input')?.focus(), 50);
        } else {
            content.style.display = 'none';
            if (toggleBtn) { toggleBtn.style.transform = 'rotate(180deg)'; if (icon) icon.className = 'fas fa-chevron-up'; }
            openBtn.textContent = 'Evet, yardım istiyorum';
            openBtn.setAttribute('aria-pressed', 'false');
        }
    });

    document.getElementById('btn-toggle-ai-page')?.addEventListener('click', () => {
        const content = document.getElementById('page-ai-content');
        const btn = document.getElementById('btn-toggle-ai-page');
        if (!content || !btn) return;
        const icon = btn.querySelector('i');
        if (content.style.display === 'none') {
            content.style.display = '';
            if (icon) icon.className = 'fas fa-chevron-down';
            btn.style.transform = 'rotate(0deg)';
        } else {
            content.style.display = 'none';
            if (icon) icon.className = 'fas fa-chevron-up';
            btn.style.transform = 'rotate(180deg)';
        }
    });

    // The page helper OK button is wired earlier when the helper is inserted; no duplicate handler here.
    
    // Router
    window.addEventListener('hashchange', handleRoute);
    handleRoute();
    
    // Menu toggle
    document.getElementById('btn-menu-toggle')?.addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('active');
    });
    
    // Theme toggle
    document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
    
    // Settings
    document.getElementById('btn-settings')?.addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('active');
    });
    
    // Word form
    document.getElementById('word-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const wordData = {
            english: document.getElementById('f-english').value,
            turkish: document.getElementById('f-turkish').value,
            pronunciation: document.getElementById('f-pron').value,
            turkishExplanation: document.getElementById('f-turkishExp').value,
            englishExplanation: document.getElementById('f-engExp').value,
            synonyms: document.getElementById('f-syn').value.split(',').map(s => s.trim()).filter(Boolean),
            antonyms: document.getElementById('f-ant').value.split(',').map(s => s.trim()).filter(Boolean),
            examples: document.getElementById('f-examples').value.split('\n').filter(Boolean),
            level: document.getElementById('f-level').value,
            categories: document.getElementById('f-cats').value.split(',').map(s => s.trim()).filter(Boolean),
            favorite: document.getElementById('f-fav').checked
        };
        
        const id = document.getElementById('word-id').value;
        
        // Validation: require Turkish translation
        if (!wordData.turkish || !wordData.turkish.trim()) {
            showToast('Please enter the Turkish translation.', 'warning');
            return;
        }

        if (id) {
            updateWord(id, wordData);
            showToast('Word updated successfully!', 'success');
        } else {
            addWord(wordData);
            showToast('Word added successfully!', 'success');
        }
        
        closeModal('panel-addWord');
        handleRoute(); // Refresh current view
    });
    
    document.getElementById('btn-cancel-word')?.addEventListener('click', () => {
        closeModal('panel-addWord');
    });
    
    // Quick add removed — use the Add Word page or Add Word modal instead.
    
    // Quiz config
    document.getElementById('btn-start-quiz')?.addEventListener('click', startQuiz);
    
    document.getElementById('quiz-source')?.addEventListener('change', (e) => {
        const categorySelector = document.getElementById('category-selector');
        categorySelector.style.display = e.target.value === 'category' ? 'block' : 'none';
    });
    
    // Settings
    document.getElementById('notification-enabled')?.addEventListener('change', (e) => {
        state.settings.notificationEnabled = e.target.checked;
        saveState();
        if (e.target.checked) {
            setupNotifications();
        }
    });
    
    document.getElementById('notification-time')?.addEventListener('change', (e) => {
        state.settings.notificationHour = e.target.value;
        saveState();
    });
    
    document.getElementById('btn-test-notification')?.addEventListener('click', () => {
        if (Notification.permission === 'granted') {
            new Notification('VocabMaster Test', {
                body: 'Notifications are working correctly!'
            });
        } else if (Notification.permission === 'default') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification('VocabMaster Test', {
                        body: 'Notifications enabled successfully!'
                    });
                }
            });
        } else {
            showToast('Notifications are blocked. Please enable them in browser settings.', 'warning');
        }
    });
    
    document.getElementById('btn-reset-learned')?.addEventListener('click', () => {
        if (confirm('Reset all learned flags? This will not delete any words.')) {
            Object.values(state.words).forEach(word => {
                word.stats.learned = false;
            });
            updateStats();
            saveState();
            showToast('Learned flags reset.', 'success');
        }
    });
    
    document.getElementById('btn-reset-stats')?.addEventListener('click', () => {
        if (confirm('Reset all statistics? This will not delete any words.')) {
            Object.values(state.words).forEach(word => {
                word.stats = {
                    ...word.stats,
                    timesTested: 0,
                    correctCount: 0,
                    wrongCount: 0,
                    lastTested: null,
                    difficultyScore: 0,
                    learned: false
                };
            });
            state.history = [];
            state.appStats.streak = { current: 0, best: 0, lastActive: null };
            updateStats();
            saveState();
            showToast('Statistics reset.', 'success');
        }
    });
    
    document.getElementById('btn-clear-all')?.addEventListener('click', confirmClearAll);
    
    // Daily reminder
    document.getElementById('btn-snooze')?.addEventListener('click', snoozeReminder);
    document.getElementById('btn-take-now')?.addEventListener('click', takeTestNow);
    
    // Notes - wire UI controls if present
    document.getElementById('note-title')?.addEventListener('input', _debouncedSaveNote);
    document.getElementById('notes-editor')?.addEventListener('input', _debouncedSaveNote);
    document.getElementById('btn-notes-close')?.addEventListener('click', closeNotesDrawer);
    document.getElementById('btn-notes-new-window')?.addEventListener('click', openNotesInNewWindow);
    document.getElementById('btn-notes-open-window')?.addEventListener('click', openNotesInNewWindow);
    document.getElementById('btn-add-note')?.addEventListener('click', addNewNote);
    document.getElementById('btn-delete-note')?.addEventListener('click', () => deleteNoteById(selectedNoteId));
    
    // Close modals
    document.querySelectorAll('.btn-close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal').classList.remove('active');
        });
    });
    
    document.getElementById('btn-confirm-cancel')?.addEventListener('click', () => {
        closeModal('confirm-modal');
    });
    
    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
    
    // Keyboard handler: Enter will fill next available letter in writing questions.
    document.addEventListener('keydown', (e) => {
        // Don't trigger if user is typing in an input or textarea
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        // If Enter pressed while on a writing question, place next available letter
        if (e.key === 'Enter') {
            try {
                if (!currentQuiz) return;
                const q = currentQuiz.questions[currentQuiz.currentIndex];
                if (!q || q.type !== 'writing') return;

                const container = document.getElementById('mainContent');
                const poolEl = container.querySelector('#letter-pool');
                const slotsEl = container.querySelector('#writing-slots');
                if (!poolEl || !slotsEl) return;

                // Find next empty slot
                const nextSlot = slotsEl.querySelector('.slot:not(.fixed):not([data-filled="true"])');
                if (!nextSlot) return;

                // Find first enabled tile
                const tile = poolEl.querySelector('.letter-tile:not([disabled])');
                if (!tile) return;

                const char = tile.getAttribute('data-char');
                const id = tile.getAttribute('data-id');

                // Place char into slot and mark tile used
                nextSlot.textContent = char;
                nextSlot.setAttribute('data-filled', 'true');
                nextSlot.setAttribute('data-from', id);
                tile.disabled = true;
                tile.classList.add('used');
            } catch (err) {
                console.error('Enter key handler error:', err);
            }
        }
    });
    
    updateStorageDisplay();
});

function handleImport(mode) {
    const fileInput = document.getElementById('import-file');
    const file = fileInput.files[0];
    
    if (!file) {
        showToast('Please select a file first.', 'warning');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        importData(e.target.result, mode);
    };
    reader.readAsText(file);
}
