window.addEventListener('load', () => {

    const hamburger = document.querySelector('.hamburger');
    const nav = document.querySelector('nav.realnav');

    hamburger.addEventListener('click', () => {
        nav.classList.toggle('active');
    });
});
