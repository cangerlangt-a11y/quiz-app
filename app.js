// ==========================================
// ⚡ Supabase 接続設定（ここをご自身のものに書き換えてください）
// ==========================================
const SUPABASE_URL = 'https://otwqwuidhkbtfniwpzvf.supabase.co'; 
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90d3F3dWlkaGtidGZuaXdwenZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzOTA0MjYsImV4cCI6MjA5Njk2NjQyNn0.dtPkiYdqo011OpytX6nCvMqiOzrdpEVZ8oj6NXPIsOE'; 

// 💡 【修正点】名前が被らないように "supabaseClient" に変更しました
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 📦 アプリ用変数（LocalStorageの読み込みは廃止し、サーバーと連動します）
// ==========================================
let appData = []; 
let currentActiveListId = null; 
let quizData = []; 
let currentQuestions = []; 
let wrongQuestions = []; 
let currentIndex = 0; 
let memoIndex = 0; 
let isCardFront = true;
let quizHistoryLogs = []; 
let lastResultFeedbackHTML = ""; 
let autoNextTimer = null; 
let isBulkDeleteMode = false; 

const inputField = document.getElementById('chemInput');
const progressText = document.getElementById('progress');
const previousAnswerArea = document.getElementById('previousAnswerArea');

// 画面読み込み時の初期化
// 画面読み込み時の初期化
window.addEventListener('DOMContentLoaded', async () => {
  initInputFieldAutoConversion(document.getElementById('chemInput'));  
  initInputFieldAutoConversion(document.getElementById('newAnswer'));  
  initInputFieldAutoConversion(document.getElementById('modalEditA')); 
  
  // ✨【新機能】単語帳の名前入力欄でEnterキーが押されたら、自動で作成する
  const newListNameInput = document.getElementById('newListName');
  if (newListNameInput) {
    newListNameInput.addEventListener('keydown', function(event) {
      if (event.key === 'Enter') {
        if (event.isComposing) return; // 💡 漢字変換を確定するためのEnterキーのときは、作成しない（スルーする）
        event.preventDefault(); // 画面がリロードされるのを防ぐ
        createNewList(); // 単語帳を作成する関数を実行！
      }
    });
  }

  window.addEventListener('hashchange', () => {
    routeView(window.location.hash);
  });

  // 1. まず最初にSupabaseから最新データをダウンロードする
  await loadAllAppDataFromSupabase();

  // 2. その後、画面の状態（どこを開いていたか）を復旧
  loadViewStateOnly();

  if (!window.location.hash || window.location.hash === '#top') {
    navigateTo('#top');
    routeView('#top');
  } else {
    routeView(window.location.hash);
  }

  document.addEventListener('click', (e) => {
    if (window.location.hash.startsWith('#quiz') && inputField && !inputField.disabled) {
      if (!e.target.closest('button') && e.target !== inputField) {
        inputField.focus();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (window.location.hash.startsWith('#quiz') && inputField && !inputField.disabled) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (document.activeElement !== inputField) {
          inputField.focus();
        }
      }
    }
  });
});

function navigateTo(hash) {
  window.location.hash = hash;
}

// 🌐 【新機能】Supabaseから全ての部屋と単語を一括取得して appData の形に整える
async function loadAllAppDataFromSupabase() {
  const { data: rooms, error: roomError } = await supabaseClient.from('rooms').select('*').order('created_at', { ascending: true });
  if (roomError) { console.error("部屋の取得失敗:", roomError); return; }

  const { data: words, error: wordError } = await supabaseClient.from('words').select('*').order('id', { ascending: true });
  if (wordError) { console.error("単語の取得失敗:", wordError); return; }

  appData = rooms.map(room => {
    const matchedItems = words ? words.filter(w => w.room_id === room.id) : [];
    return {
      listId: room.id,
      listName: room.title,
      items: matchedItems.map(w => ({ id: w.id, question: w.question, answer: w.answer }))
    };
  });
}

function routeView(hash) {
  document.querySelectorAll('.app-view').forEach(v => v.style.display = 'none');
  isBulkDeleteMode = false; 
  
  if (document.getElementById('bulkDeleteTriggerBtn')) document.getElementById('bulkDeleteTriggerBtn').style.display = "inline-block";
  if (document.getElementById('bulkExecuteBtn')) document.getElementById('bulkExecuteBtn').style.display = "none";
  if (document.getElementById('bulkCancelBtn')) document.getElementById('bulkCancelBtn').style.display = "none";

  if (!hash || hash.startsWith('#top')) {
    document.getElementById('topView').style.display = 'block';
    renderTopView();
  } 
  else if (hash.startsWith('#list')) {
    if (!currentActiveListId) { navigateTo('#top'); return; }
    document.getElementById('mainListView').style.display = 'block';
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) {
      document.getElementById('currentListTitle').textContent = foundList.listName;
      renderMainList();
      updateWrongCountLabel();
    }
  } 
  else if (hash.startsWith('#memorize')) {
    if (!currentActiveListId || currentQuestions.length === 0) { navigateTo('#list'); return; }
    document.getElementById('memorizeView').style.display = 'block';
    showMemoCard();
    if (!isCardFront) {
      const card = document.getElementById('bigCard');
      card.textContent = currentQuestions[memoIndex].answer;
      card.classList.add('back-style');
    }
  } 
  else if (hash.startsWith('#quiz')) {
    if (!currentActiveListId || currentQuestions.length === 0) { navigateTo('#list'); return; }
    document.getElementById('quizView').style.display = 'block';
    document.getElementById('quizPlayArea').style.display = 'block';
    document.getElementById('quizResultArea').style.display = 'none';
    showQuestion();
  } 
  else if (hash.startsWith('#result')) {
    if (!currentActiveListId) { navigateTo('#top'); return; }
    document.getElementById('quizView').style.display = 'block';
    document.getElementById('quizPlayArea').style.display = 'none';
    document.getElementById('quizResultArea').style.display = 'block';
    showQuizReviewSummary();
  }
}

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function saveViewState() {
  const state = {
    listId: currentActiveListId,
    modeType: document.getElementById('modeWrongList') && document.getElementById('modeWrongList').checked ? 'wrong' : 'normal',
    rangeStart: document.getElementById('rangeStart') ? document.getElementById('rangeStart').value : "1",
    rangeEnd: document.getElementById('rangeEnd') ? document.getElementById('rangeEnd').value : "1",
    orderType: document.getElementById('orderRandom') && document.getElementById('orderRandom').checked ? 'random' : 'normal',
    maxQuestions: document.getElementById('maxQuestions') ? document.getElementById('maxQuestions').value : "",
    currentIndex: currentIndex,
    memoIndex: memoIndex,
    isCardFront: isCardFront,
    currentQuestions: currentQuestions,
    quizHistoryLogs: quizHistoryLogs,
    lastResultFeedbackHTML: lastResultFeedbackHTML
  };
  localStorage.setItem('multi_notebook_view_state', JSON.stringify(state));
}

function loadViewStateOnly() {
  const saved = localStorage.getItem('multi_notebook_view_state');
  if (!saved) return;
  try {
    const state = JSON.parse(saved);
    currentActiveListId = state.listId;
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) quizData = foundList.items;

    if (document.getElementById('modeWrongList')) {
      if (state.modeType === 'wrong') document.getElementById('modeWrongList').checked = true;
      else document.getElementById('modeNormal').checked = true;
      toggleModeUI();
    }
    if (document.getElementById('rangeStart')) document.getElementById('rangeStart').value = state.rangeStart || 1;
    if (document.getElementById('rangeEnd')) document.getElementById('rangeEnd').value = state.rangeEnd || (quizData.length > 0 ? quizData.length : 1);
    if (document.getElementById('orderRandom')) {
      if (state.orderType === 'random') document.getElementById('orderRandom').checked = true;
      else document.getElementById('orderNormal').checked = true;
    }
    if (document.getElementById('maxQuestions')) document.getElementById('maxQuestions').value = state.maxQuestions || "";
    
    currentIndex = state.currentIndex || 0;
    memoIndex = state.memoIndex || 0;
    isCardFront = (state.isCardFront !== undefined) ? state.isCardFront : true;
    currentQuestions = state.currentQuestions || [];
    quizHistoryLogs = state.quizHistoryLogs || [];
    lastResultFeedbackHTML = state.lastResultFeedbackHTML || "";
  } catch(e) {
    console.error("状態復帰エラー", e);
  }
}

function renderTopView() {
  const gallery = document.getElementById('listGallery');
  if(!gallery) return;
  gallery.innerHTML = "";

  appData.forEach(list => {
    const card = document.createElement('div');
    card.className = "list-card";
    
    const infoWrapper = document.createElement('div');
    infoWrapper.className = "list-info";
    infoWrapper.onclick = () => openNotebook(list.listId);
    infoWrapper.innerHTML = `
      <span class="list-title-text">${list.listName}</span>
      <span class="list-count-badge">${list.items.length} 問収録</span>
    `;
    card.appendChild(infoWrapper);

    const delBtn = document.createElement('button');
    delBtn.className = "direct-delete-btn";
    delBtn.innerHTML = "🗑️";
    delBtn.title = "このリストを削除";
    delBtn.onclick = (e) => {
      e.stopPropagation(); 
      triggerDeleteListModal(list.listId, list.listName);
    };
    card.appendChild(delBtn);

    gallery.appendChild(card);
  });
}

function triggerDeleteListModal(listId, listName) {
  document.getElementById('deleteModalText').innerHTML = `本当に単語帳<b>「${listName}」</b>を丸ごと削除してもよろしいですか？<br>この操作は取り消せません。`;
  openModal('deleteModal');
  
  document.getElementById('modalConfirmDeleteBtn').onclick = async () => {
    await supabaseClient.from('words').delete().eq('room_id', listId);
    await supabaseClient.from('rooms').delete().eq('id', listId);
    localStorage.removeItem(`chem_wrong_ids_${listId}`);
    
    closeModal('deleteModal');
    await loadAllAppDataFromSupabase(); 
    renderTopView();
    saveViewState();
  };
}

async function createNewList() {
  const input = document.getElementById('newListName');
  const name = input.value.trim();
  if (name === "") return;

  const { data, error } = await supabaseClient.from('rooms').insert([{ title: name }]).select();
  if (error) { alert("部屋の作成に失敗しました:" + error.message); return; }

  const newRoomId = data[0].id;
  input.value = "";
  
  await loadAllAppDataFromSupabase(); 
  renderTopView();
  openNotebook(newRoomId); 
}

function openNotebook(listId) {
  currentActiveListId = listId;
  const foundList = appData.find(l => l.listId === listId);
  if (foundList) {
    quizData = foundList.items;
    saveViewState();
    navigateTo('#list');
  }
}

async function editListNameInline() {
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (!foundList) return;
  
  const newName = prompt("新しい単語帳の名前を入力してください：", foundList.listName);
  if (newName === null) return; 
  const trimmed = newName.trim();
  if (trimmed === "") { alert("名前を空にすることはできません。"); return; }
  
  const { error } = await supabaseClient.from('rooms').update({ title: trimmed }).eq('id', currentActiveListId);
  if (error) { alert("名前の変更に失敗しました"); return; }

  foundList.listName = trimmed;
  document.getElementById('currentListTitle').textContent = trimmed;
  await loadAllAppDataFromSupabase();
  saveViewState();
}

function renderMainList() {
  const container = document.getElementById('listContainer');
  if (!container) return;
  container.innerHTML = ""; 

  quizData.forEach((data, index) => {
    const item = document.createElement('div');
    item.className = "list-item";
    item.setAttribute('draggable', 'false'); 
    item.dataset.id = data.id;

    item.onclick = (e) => {
      if (isBulkDeleteMode) {
        const targetChk = item.querySelector('.bulk-checkbox');
        if (targetChk && e.target !== targetChk) {
          targetChk.checked = !targetChk.checked;
        }
      } else {
        if (!e.target.closest('.direct-delete-btn')) {
          triggerEditWordModal(data.id, data.question, data.answer);
        }
      }
    };

    const textBlock = document.createElement('div');
    textBlock.className = "list-text-block";
    textBlock.innerHTML = `
      <div><span class="list-num">${index + 1}.</span><span class="list-q">${data.question}</span></div>
      <span class="list-a">${data.answer}</span>
    `;
    item.appendChild(textBlock);

    const rightActions = document.createElement('div');
    rightActions.className = "list-actions-right";

    const chk = document.createElement('input');
    chk.type = "checkbox";
    chk.className = "bulk-checkbox";
    chk.value = data.id;

    const delBtn = document.createElement('button');
    delBtn.className = "direct-delete-btn";
    delBtn.innerHTML = "🗑️";
    delBtn.title = "この単語を削除";
    
    if (isBulkDeleteMode) {
      delBtn.style.display = "none";
      chk.style.display = "inline-block";
    } else {
      delBtn.style.display = "flex";
      chk.style.display = "none";
    }
    
    delBtn.onclick = (e) => { 
      e.stopPropagation(); 
      if (isBulkDeleteMode) return;
      executeDirectDeleteWord(data.id); 
    };

    rightActions.appendChild(chk);
    rightActions.appendChild(delBtn);
    item.appendChild(rightActions);

    container.appendChild(item);
  });

  if (quizData.length > 0) {
    if(!document.getElementById('rangeEnd').value || document.getElementById('rangeEnd').value == "1") {
      document.getElementById('rangeEnd').value = quizData.length;
    }
  }
}

async function executeDirectDeleteWord(wordId) {
  const { error } = await supabaseClient.from('words').delete().eq('id', wordId);
  if (error) { alert("削除に失敗しました"); return; }

  let wrongIds = getSavedWrongIds();
  wrongIds = wrongIds.filter(id => id !== wordId);
  saveWrongIds(wrongIds);
  
  await loadAllAppDataFromSupabase();
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (foundList) quizData = foundList.items;

  const currentLen = quizData.length > 0 ? quizData.length : 1;
  document.getElementById('rangeEnd').value = currentLen;
  if (parseInt(document.getElementById('rangeStart').value) > currentLen) {
    document.getElementById('rangeStart').value = currentLen;
  }
  renderMainList();
  saveViewState();
}

function toggleBulkDeleteMode() {
  isBulkDeleteMode = !isBulkDeleteMode;
  const trigger = document.getElementById('bulkDeleteTriggerBtn');
  const execute = document.getElementById('bulkExecuteBtn');
  const cancel = document.getElementById('bulkCancelBtn');
  
  if (isBulkDeleteMode) {
    trigger.style.display = "none";
    execute.style.display = "inline-block";
    cancel.style.display = "inline-block";
  } else {
    trigger.style.display = "inline-block";
    execute.style.display = "none";
    cancel.style.display = "none";
  }
  renderMainList();
}

async function executeBulkDelete() {
  const checkedBoxes = document.querySelectorAll('#listContainer .bulk-checkbox:checked');
  if (checkedBoxes.length === 0) { alert("削除する単語が選択されていません。"); return; }

  const idsToDelete = Array.from(checkedBoxes).map(cb => parseInt(cb.value));
  
  const { error } = await supabaseClient.from('words').delete().in('id', idsToDelete);
  if (error) { alert("まとめて削除に失敗しました"); return; }

  let wrongIds = getSavedWrongIds();
  wrongIds = wrongIds.filter(id => !idsToDelete.includes(id));
  saveWrongIds(wrongIds);
  
  await loadAllAppDataFromSupabase();
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (foundList) quizData = foundList.items;

  const currentLen = quizData.length > 0 ? quizData.length : 1;
  document.getElementById('rangeEnd').value = currentLen;
  if (parseInt(document.getElementById('rangeStart').value) > currentLen) {
    document.getElementById('rangeStart').value = currentLen;
  }

  isBulkDeleteMode = false;
  document.getElementById('bulkDeleteTriggerBtn').style.display = "inline-block";
  document.getElementById('bulkExecuteBtn').style.display = "none";
  document.getElementById('bulkCancelBtn').style.display = "none";
  
  renderMainList();
  saveViewState();
}

function triggerEditWordModal(id, oldQ, oldA) {
  document.getElementById('modalEditQ').value = oldQ;
  document.getElementById('modalEditA').value = oldA;
  openModal('editWordModal');

  document.getElementById('modalConfirmEditBtn').onclick = async () => {
    const newQ = document.getElementById('modalEditQ').value.trim();
    const newA = document.getElementById('modalEditA').value.trim();
    if (newQ === "" || newA === "") return;

    const { error } = await supabaseClient.from('words').update({ question: newQ, answer: newA }).eq('id', id);
    if (error) { alert("単語の更新に失敗しました"); return; }

    closeModal('editWordModal');
    await loadAllAppDataFromSupabase();
    const foundList = appData.find(l => l.listId === currentActiveListId);
    if (foundList) quizData = foundList.items;
    
    renderMainList();
    saveViewState();
  };
}

async function addNewProblem() {
  const qInput = document.getElementById('newQuestion');
  const aInput = document.getElementById('newAnswer');
  if (qInput.value.trim() === "" || aInput.value.trim() === "") return;

  const { error } = await supabaseClient.from('words').insert([
    { 
      room_id: currentActiveListId, 
      question: qInput.value.trim(), 
      answer: aInput.value.trim() 
    }
  ]);

  if (error) { alert("単語の追加に失敗しました"); return; }

  qInput.value = ""; aInput.value = "";
  
  await loadAllAppDataFromSupabase(); 
  const foundList = appData.find(l => l.listId === currentActiveListId);
  if (foundList) quizData = foundList.items;

  renderMainList();
  saveViewState();
  qInput.focus(); 
}

function validateCounter(input) {
  let val = parseInt(input.value); 
  const maxVal = quizData.length > 0 ? quizData.length : 1;
  if (isNaN(val)) { input.value = 1; return; }
  if (val < 1) { input.value = maxVal; } else if (val > maxVal) { input.value = 1; }
}

function startMemorizeMode() {
  if (!prepareQuestions()) return;
  memoIndex = 0;
  saveViewState();
  navigateTo('#memorize');
}

function showMemoCard() {
  isCardFront = true;
  const card = document.getElementById('bigCard');
  if(!card) return;
  card.classList.remove('back-style');
  document.getElementById('memoProgress').textContent = `暗記カード： ${memoIndex + 1} / ${currentQuestions.length}`;
  card.textContent = currentQuestions[memoIndex].question;

  const prevWrapper = document.getElementById('memoPrevBtnWrapper');
  if(prevWrapper) {
    prevWrapper.style.visibility = (memoIndex === 0) ? "hidden" : "visible";
  }
}

function flipBigCard() {
  const card = document.getElementById('bigCard');
  card.textContent = isCardFront ? currentQuestions[memoIndex].answer : currentQuestions[memoIndex].question;
  card.classList.toggle('back-style', isCardFront);
  isCardFront = !isCardFront;
  saveViewState();
}

function nextMemo() {
  if (memoIndex < currentQuestions.length - 1) { memoIndex++; showMemoCard(); saveViewState(); } 
  else { openModal('memoEndModal'); }
}

function prevMemo() { if (memoIndex > 0) { memoIndex--; showMemoCard(); saveViewState(); } }
function restartMemorize() { closeModal('memoEndModal'); memoIndex = 0; showMemoCard(); saveViewState(); }
function exitMemorize() { closeModal('memoEndModal'); backToMainList(); }

function backToMainList() {
  if (autoNextTimer) clearTimeout(autoNextTimer); 
  navigateTo('#list');
}

function startQuizMode() {
  if (!prepareQuestions()) return;
  quizHistoryLogs = []; 
  lastResultFeedbackHTML = ""; 
  saveViewState();
  navigateTo('#quiz');
}

function retryQuiz(retryMode) {
  if (autoNextTimer) clearTimeout(autoNextTimer);
  
  if (retryMode === 'wrong') {
    const wrongItems = [];
    quizHistoryLogs.forEach(log => {
      if (!log.isCorrect) {
        const match = quizData.find(item => item.question === log.question);
        if (match) wrongItems.push(match);
      }
    });
    if (wrongItems.length === 0) { alert("間違えた問題はありません！🎉"); return; }
    currentQuestions = wrongItems;
  } else {
    if (!prepareQuestions()) return;
  }
  
  currentIndex = 0;
  quizHistoryLogs = [];
  lastResultFeedbackHTML = "";
  saveViewState();
  navigateTo('#quiz');
  routeView('#quiz'); 
}

function getSavedWrongIds() { return JSON.parse(localStorage.getItem(`chem_wrong_ids_${currentActiveListId}`)) || []; }
function saveWrongIds(ids) { localStorage.setItem(`chem_wrong_ids_${currentActiveListId}`, JSON.stringify(ids)); updateWrongCountLabel(); }
function updateWrongCountLabel() { const lbl = document.getElementById('wrongCountLabel'); if(lbl) lbl.textContent = getSavedWrongIds().length; }
function toggleModeUI() { const area = document.getElementById('normalConfigArea'); if(area) area.style.display = document.getElementById('modeNormal').checked ? 'block' : 'none'; }

function prepareQuestions() {
  if (quizData.length === 0) { alert("問題が登録されていません。"); return false; }
  
  let startVal = parseInt(document.getElementById('rangeStart').value) || 1;
  let endVal = parseInt(document.getElementById('rangeEnd').value) || quizData.length;
  if (startVal > endVal) { alert("出題範囲の開始が終了を上回っています。"); return false; }

  let filtered = document.getElementById('modeNormal').checked ? quizData.slice(startVal - 1, endVal) : quizData.filter(q => getSavedWrongIds().includes(q.id));
  if (filtered.length === 0) { alert("出題条件に該当する問題がありません。"); return false; }

  if (document.getElementById('orderRandom').checked) {
    for (let i = filtered.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [filtered[i], filtered[j]] = [filtered[j], filtered[i]]; }
  }
  let maxQ = parseInt(document.getElementById('maxQuestions').value);
  if (!isNaN(maxQ) && maxQ > 0) filtered = filtered.slice(0, maxQ);

  currentQuestions = filtered; currentIndex = 0; wrongQuestions = [];
  return true;
}

function showQuestion() {
  if (autoNextTimer) clearTimeout(autoNextTimer); 
  inputField.value = ""; inputField.disabled = false;
  
  const submitBtn = document.getElementById('submitBtn');
  const resetBtn = document.getElementById('resetBtn');
  if (submitBtn) submitBtn.disabled = false;
  if (resetBtn) resetBtn.disabled = false;

  progressText.textContent = `第 ${currentIndex + 1} 問 / 全 ${currentQuestions.length} 問`;
  document.getElementById('quizBigCardQuestion').textContent = currentQuestions[currentIndex].question;
  
  if (lastResultFeedbackHTML) {
    previousAnswerArea.innerHTML = lastResultFeedbackHTML;
  } else {
    previousAnswerArea.innerHTML = "";
  }
  
  inputField.focus();
}

function resetQuizInput() {
  inputField.value = "";
  inputField.focus();
}

function checkAnswer() {
  if (inputField.disabled) return;

  let userText = inputField.value; let currentQ = currentQuestions[currentIndex]; let correctAnswer = currentQ.answer;
  function simplify(t) { return t.replaceAll('+','').replaceAll('⁺','').replaceAll('→','').replaceAll('->','').replaceAll(' ',''); }
  let wrongIds = getSavedWrongIds();
  let isCorrect = simplify(userText) === simplify(correctAnswer);

  quizHistoryLogs.push({ question: currentQ.question, correctAnswer: correctAnswer, userAns: userText, isCorrect: isCorrect });

  inputField.disabled = true; 
  const submitBtn = document.getElementById('submitBtn');
  const resetBtn = document.getElementById('resetBtn');
  if (submitBtn) submitBtn.disabled = true;
  if (resetBtn) resetBtn.disabled = true;

  if (isCorrect) {
    lastResultFeedbackHTML = `前問の判定: <span class="prev-correct">⭕ 正解</span>（${currentQ.question} ➔ ${correctAnswer}）`;
    wrongIds = wrongIds.filter(id => id !== currentQ.id);
  } else {
    lastResultFeedbackHTML = `前問の判定: <span class="prev-wrong">❌ 不正解</span>（${currentQ.question} ➔ 正解: <span style="color:#2196f3;">${correctAnswer}</span>）`;
    wrongQuestions.push(currentQ);
    if (!wrongIds.includes(currentQ.id)) wrongIds.push(currentQ.id);
  }
  
  saveWrongIds(wrongIds);
  saveViewState();
  
  autoNextTimer = setTimeout(() => {
    nextQuestion();
  }, 100);
}

function nextQuestion() {
  currentIndex++;
  if (currentIndex < currentQuestions.length) { 
    saveViewState();
    showQuestion(); 
  } else { 
    saveViewState();
    navigateTo('#result'); 
  }
}

function showQuizReviewSummary() {
  const wrongCount = quizHistoryLogs.filter(l => !l.isCorrect).length;
  const retryWrongBtn = document.getElementById('retryWrongBtn');
  if (retryWrongBtn) {
    retryWrongBtn.style.display = wrongCount > 0 ? "inline-block" : "none";
  }
  document.getElementById('quizFinalScore').textContent = `🏁 テスト終了！ 正解数: ${quizHistoryLogs.filter(l => l.isCorrect).length} / ${quizHistoryLogs.length}`;
  switchReviewTab('all'); 
}

function switchReviewTab(tabType) {
  const tabAll = document.getElementById('tabAllBtn');
  const tabWrong = document.getElementById('tabWrongBtn');
  if (tabType === 'all') {
    tabAll.className = "btn btn-action"; tabWrong.className = "btn btn-sub";
    renderReviewRows(quizHistoryLogs);
  } else {
    tabAll.className = "btn btn-sub"; tabWrong.className = "btn btn-action";
    renderReviewRows(quizHistoryLogs.filter(log => !log.isCorrect));
  }
}

function renderReviewRows(logsArray) {
  const tbody = document.getElementById('reviewTableBody');
  if(!tbody) return;
  tbody.innerHTML = "";
  if (logsArray.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:gray; padding:20px;">該当する問題はありません。</td></tr>`;
    return;
  }
  logsArray.forEach(log => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="${log.isCorrect ? 'status-ok' : 'status-ng'}">${log.isCorrect ? '⭕ 正解' : '❌ 不正解'}</td>
      <td><b>${log.question}</b></td>
      <td style="color:#2196f3; font-weight:bold;">${log.correctAnswer}</td>
    `;
    tbody.appendChild(tr);
  });
}

function initInputFieldAutoConversion(targetInput) {
  if (!targetInput) return;
  
  let isShiftPressed = false;
  targetInput.addEventListener('keydown', function(e) {
    if (e.key === 'Shift') isShiftPressed = true;
  });
  targetInput.addEventListener('keyup', function(e) {
    if (e.key === 'Shift') isShiftPressed = false;
  });

  targetInput.addEventListener('input', function() {
    let start = targetInput.selectionStart; 
    let val = targetInput.value;
    
    val = val.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    val = val.replaceAll('；', ';').replaceAll('ー', '-').replaceAll('．', '.').replaceAll('”', '"').replaceAll(' ', ' ');
    val = val.replaceAll('＋', '+');

    const shiftNumbers = { '!': '1', '"': '2', '#': '3', '$': '4', '%': '5', '&': '6', "'": '7', '(': '8', ')': '9' };
    for (let key in shiftNumbers) { val = val.replaceAll(key, shiftNumbers[key]); }
    
    if (isShiftPressed) {
      val = val.replaceAll(';', '⁺').replaceAll('-', '⁻').replaceAll('.', '･').replaceAll(' ', '→');
    } else {
      val = val.replaceAll(';', '⁺').replaceAll('+', '⁺').replaceAll('-', '⁻').replaceAll('.', '･').replaceAll(' ', '→');
    }
    val = val.toUpperCase();
    
    val = val.replaceAll('E-', 'e-');
    val = val.replaceAll('E⁺', 'e⁺');
    val = val.replaceAll('E⁻', 'e⁻');

    const elements2char = ['He','Li','Be','Ne','Na','Mg','Al','Si','Cl','Ar','K','Ca','Sc','Ti','V','Cr','Mn','Fe','Ni','Cu','Zn','Ga','Ge','As','Se','Br','Kr','Rb','Sr','Y','Zr','Nb','Mo','Tc','Ru','Rh','Pd','Ag','Cd','In','Sn','Sb','Te','I','Xe','Cs','Ba','Pt','Au','Hg','Pb','Bi','Po','At','Rn','Fr','Ra','U'];
    elements2char.forEach(el => { val = val.replaceAll(el.toUpperCase(), el); });
    
    let newVal = "";
    for (let i = 0; i < val.length; i++) {
      let char = val[i];
      if (char >= '0' && char <= '9') {
        let shouldSub = false; 
        if (i > 0) { 
          let prev = val[i-1]; 
          if (/[A-Za-z)\]₀₁₂₃₄₅₆₇₈₉⁺⁻]/.test(prev)) shouldSub = true; 
          if (/[ +\-→]/.test(prev)) shouldSub = false; 
        }
        if (i === 0) shouldSub = false;
        if (shouldSub) { 
          const subs = {'0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'}; 
          char = subs[char]; 
        }
      }
      newVal += char;
    }
    newVal = newVal.replaceAll('E⁻', 'e⁻').replaceAll('E⁺', 'e⁺');
    
    if (targetInput.value !== newVal) { 
      targetInput.value = newVal; 
      targetInput.selectionStart = targetInput.selectionEnd = start; 
    }
  });
}

inputField.addEventListener('keydown', function(event) {
  if (event.key === 'Enter') { 
    if (event.isComposing) return; 
    event.preventDefault(); 
    checkAnswer(); 
  }
});