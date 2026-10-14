window.addEventListener('load', () => {
    
    const hamburger = document.querySelector('.hamburger');
    const nav = document.querySelector('nav.realnav');
    
    nav.classList.toggle('hidden');
    
    hamburger.addEventListener('click', () => {
        nav.classList.toggle('hidden');
    });
});
